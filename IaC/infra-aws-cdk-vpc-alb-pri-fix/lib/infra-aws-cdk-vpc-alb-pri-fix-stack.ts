import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

// 設定関連のクラスとインターフェース
namespace Config {
  export interface IInfraConfig {
    readonly prefix: string;
    readonly region: string;
    readonly appPort: number;
    readonly vpcCidr: string;
    readonly publicSubnet1Cidr: string;
    readonly publicSubnet2Cidr: string;
    readonly privateSubnet1Cidr: string;
    readonly privateSubnet2Cidr: string;
    readonly healthCheckPath: string;
    readonly usePrivateSubnet: boolean;
  }

  export class InfraConfig implements IInfraConfig {
    public readonly prefix = 'cdk-vpc-js-express-ejs-8080';
    public readonly region = 'ap-northeast-1';
    public readonly appPort = 8080;
    public readonly vpcCidr = '10.0.0.0/16';
    public readonly publicSubnet1Cidr = '10.0.10.0/24';
    public readonly publicSubnet2Cidr = '10.0.11.0/24';
    public readonly privateSubnet1Cidr = '10.0.20.0/24';
    public readonly privateSubnet2Cidr = '10.0.21.0/24';
    public readonly healthCheckPath = '/health';
    public readonly usePrivateSubnet = true;

    public validate(): void {
      if (!this.validateCidrRanges()) throw new Error('Invalid CIDR ranges');
      if (!this.validatePortRange()) throw new Error('Invalid port number');
      if (!this.validateRegion()) throw new Error('Invalid region');
    }

    private validateCidrRanges(): boolean {
      const cidrs = [
        this.vpcCidr,
        this.publicSubnet1Cidr,
        this.publicSubnet2Cidr,
        this.privateSubnet1Cidr,
        this.privateSubnet2Cidr
      ];
      return cidrs.every(cidr => this.isValidCidr(cidr));
    }

    private validatePortRange(): boolean {
      return this.appPort > 0 && this.appPort <= 65535;
    }

    private validateRegion(): boolean {
      return this.region.startsWith('ap-northeast-');
    }

    private isValidCidr(cidr: string): boolean {
      const [, mask] = cidr.split('/');
      const maskNum = parseInt(mask);
      return maskNum >= 16 && maskNum <= 28;
    }
  }
}

// ネットワークリソース管理
class NetworkStack {
  private readonly vpc: ec2.Vpc;
  private readonly albSecurityGroup: ec2.SecurityGroup;
  private readonly instanceSecurityGroup: ec2.SecurityGroup;

  constructor(
    private readonly scope: Construct,
    private readonly config: Config.IInfraConfig
  ) {
    this.vpc = this.createVpc();
    this.albSecurityGroup = this.createAlbSecurityGroup();
    this.instanceSecurityGroup = this.createInstanceSecurityGroup();
  }

  public getVpc(): ec2.Vpc { return this.vpc; }
  public getAlbSecurityGroup(): ec2.SecurityGroup { return this.albSecurityGroup; }
  public getInstanceSecurityGroup(): ec2.SecurityGroup { return this.instanceSecurityGroup; }

  private createVpc(): ec2.Vpc {
    const subnetConfiguration = [
      {
        cidrMask: 24,
        name: 'Public',
        subnetType: ec2.SubnetType.PUBLIC,
      }
    ];

    if (this.config.usePrivateSubnet) {
      subnetConfiguration.push({
        cidrMask: 24,
        name: 'Private',
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      });
    }

    return new ec2.Vpc(this.scope, `${this.config.prefix}-vpc`, {
      vpcName: `${this.config.prefix}-vpc`,
      ipAddresses: ec2.IpAddresses.cidr(this.config.vpcCidr),
      maxAzs: 2,
      natGateways: this.config.usePrivateSubnet ? 1 : 0,
      subnetConfiguration,
    });
  }

  private createAlbSecurityGroup(): ec2.SecurityGroup {
    const sg = new ec2.SecurityGroup(this.scope, 'AlbSecurityGroup', {
      vpc: this.vpc,
      securityGroupName: `${this.config.prefix}-alb-sg`,
      description: 'Security group for Application Load Balancer',
      allowAllOutbound: true,
    });

    sg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow inbound HTTP traffic'
    );

    return sg;
  }

  private createInstanceSecurityGroup(): ec2.SecurityGroup {
    const sg = new ec2.SecurityGroup(this.scope, 'InstanceSecurityGroup', {
      vpc: this.vpc,
      securityGroupName: `${this.config.prefix}-instance-sg`,
      description: 'Security group for application instances',
      allowAllOutbound: true,
    });

    sg.addIngressRule(
      ec2.Peer.securityGroupId(this.albSecurityGroup.securityGroupId),
      ec2.Port.tcp(this.config.appPort),
      'Allow traffic from ALB'
    );

    return sg;
  }
}

// ロードバランサーリソース管理
class LoadBalancerStack {
  private readonly alb: elbv2.ApplicationLoadBalancer;
  private readonly targetGroup: elbv2.ApplicationTargetGroup;

  constructor(
    private readonly scope: Construct,
    private readonly config: Config.IInfraConfig,
    private readonly network: NetworkStack
  ) {
    this.alb = this.createLoadBalancer();
    this.targetGroup = this.createTargetGroup();
    this.setupListener();
  }

  public getAlb(): elbv2.ApplicationLoadBalancer { return this.alb; }
  public getTargetGroup(): elbv2.ApplicationTargetGroup { return this.targetGroup; }

  private createLoadBalancer(): elbv2.ApplicationLoadBalancer {
    return new elbv2.ApplicationLoadBalancer(this.scope, `${this.config.prefix}-alb`, {
      vpc: this.network.getVpc(),
      internetFacing: true,
      loadBalancerName: `${this.config.prefix}-alb`,
      securityGroup: this.network.getAlbSecurityGroup(),
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC }
    });
  }

  private createTargetGroup(): elbv2.ApplicationTargetGroup {
    return new elbv2.ApplicationTargetGroup(this.scope, `${this.config.prefix}-tg`, {
      vpc: this.network.getVpc(),
      port: this.config.appPort,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.INSTANCE,
      healthCheck: {
        path: this.config.healthCheckPath,
        port: 'traffic-port',
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 2,
        timeout: cdk.Duration.seconds(5),
        interval: cdk.Duration.seconds(30),
      }
    });
  }

  private setupListener(): void {
    this.alb.addListener('HttpListener', {
      port: 80,
      defaultTargetGroups: [this.targetGroup],
    });
  }
}

// スタック出力管理
class StackOutput {
  constructor(
    private readonly scope: Construct,
    private readonly network: NetworkStack,
    private readonly loadBalancer: LoadBalancerStack,
    private readonly config: Config.IInfraConfig
  ) {
    this.outputVpcInfo();
    this.outputLoadBalancerInfo();
    this.outputSecurityGroupInfo();
  }

  private outputVpcInfo(): void {
    const vpc = this.network.getVpc();
    new cdk.CfnOutput(this.scope, 'VpcInfo', {
      value: JSON.stringify({
        vpcId: vpc.vpcId,
        publicSubnets: vpc.publicSubnets.map(subnet => ({
          id: subnet.subnetId,
          az: subnet.availabilityZone,
          cidr: subnet.ipv4CidrBlock
        })),
        privateSubnets: vpc.privateSubnets.map(subnet => ({
          id: subnet.subnetId,
          az: subnet.availabilityZone,
          cidr: subnet.ipv4CidrBlock
        }))
      }, null, 2),
      description: 'VPC Information'
    });
  }

  private outputLoadBalancerInfo(): void {
    const alb = this.loadBalancer.getAlb();
    new cdk.CfnOutput(this.scope, 'LoadBalancerInfo', {
      value: JSON.stringify({
        dnsName: alb.loadBalancerDnsName,
        url: `http://${alb.loadBalancerDnsName}`,
        healthCheckUrl: `http://${alb.loadBalancerDnsName}/health`
      }, null, 2),
      description: 'Load Balancer Information'
    });
  }

  private outputSecurityGroupInfo(): void {
    new cdk.CfnOutput(this.scope, 'SecurityGroupInfo', {
      value: JSON.stringify({
        loadBalancer: {
          id: this.network.getAlbSecurityGroup().securityGroupId,
          ingressRules: ['80 from 0.0.0.0/0']
        },
        instance: {
          id: this.network.getInstanceSecurityGroup().securityGroupId,
          ingressRules: [`${this.config.appPort} from ALB`]
        }
      }, null, 2),
      description: 'Security Group Information'
    });
  }
}

// メインスタッククラス
export class InfraAwsCdkVpcAlbPriFixStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      ...props,
      env: { region: 'ap-northeast-1' },
    });

    const config = new Config.InfraConfig();
    config.validate();

    const network = new NetworkStack(this, config);
    const loadBalancer = new LoadBalancerStack(this, config, network);
    new StackOutput(this, network, loadBalancer, config);
  }
}
