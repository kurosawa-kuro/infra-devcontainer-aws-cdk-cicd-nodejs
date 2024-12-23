import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

// 基本的なインフラ設定の型定義
interface IInfraConfig {
  readonly prefix: string;
  readonly region: string;
  readonly appPort: number;
  readonly vpcCidr: string;
  readonly publicSubnet1Cidr: string;
  readonly publicSubnet2Cidr: string;
  readonly privateSubnet1Cidr: string;
  readonly privateSubnet2Cidr: string;
  readonly healthCheckPath: string;
}

// インフラ設定の検証インターフェース
interface IConfigValidator {
  validateCidrRanges(): boolean;
  validatePortRange(): boolean;
  validateRegion(): boolean;
}

// インフラ設定の実装
class InfraConfig implements IInfraConfig, IConfigValidator {
  public readonly prefix = 'cdk-vpc-js-express-ejs-8080';
  public readonly region = 'ap-northeast-1';
  public readonly appPort = 8080;
  public readonly vpcCidr = '10.0.0.0/16';
  public readonly publicSubnet1Cidr = '10.0.10.0/24';
  public readonly publicSubnet2Cidr = '10.0.11.0/24';
  public readonly privateSubnet1Cidr = '10.0.20.0/24';
  public readonly privateSubnet2Cidr = '10.0.21.0/24';
  public readonly healthCheckPath = '/health';

  // CIDR範囲の検証
  public validateCidrRanges(): boolean {
    const cidrs = [
      this.vpcCidr,
      this.publicSubnet1Cidr,
      this.publicSubnet2Cidr,
      this.privateSubnet1Cidr,
      this.privateSubnet2Cidr
    ];
    return cidrs.every(cidr => this.isValidCidr(cidr));
  }

  // ポート範囲の検証
  public validatePortRange(): boolean {
    return this.appPort > 0 && this.appPort <= 65535;
  }

  // リージョンの検証
  public validateRegion(): boolean {
    return this.region.startsWith('ap-northeast-');
  }

  private isValidCidr(cidr: string): boolean {
    const [, mask] = cidr.split('/');
    const maskNum = parseInt(mask);
    return maskNum >= 16 && maskNum <= 28;
  }
}

// リソース名の生成を管理
class ResourceNaming {
  constructor(private readonly config: IInfraConfig) {}

  public getVpcName(): string { return `${this.config.prefix}-vpc`; }
  public getAlbSecurityGroupName(): string { return `${this.config.prefix}-alb-sg`; }
  public getInstanceSecurityGroupName(): string { return `${this.config.prefix}-instance-sg`; }
  public getLoadBalancerName(): string { return `${this.config.prefix}-alb`; }
  public getTargetGroupName(): string { return `${this.config.prefix}-tg`; }
}

// VPCリソースの作成を管理
class VpcFactory {
  constructor(
    private readonly scope: Construct,
    private readonly config: IInfraConfig,
    private readonly naming: ResourceNaming
  ) {}

  public create(): ec2.Vpc {
    return new ec2.Vpc(this.scope, this.naming.getVpcName(), {
      vpcName: this.naming.getVpcName(),
      ipAddresses: ec2.IpAddresses.cidr(this.config.vpcCidr),
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        }
      ],
    });
  }
}

// セキュリティグループの作成を管理
class SecurityGroupFactory {
  constructor(
    private readonly scope: Construct,
    private readonly config: IInfraConfig,
    private readonly naming: ResourceNaming,
    private readonly vpc: ec2.Vpc
  ) {}

  public createLoadBalancerSecurityGroup(): ec2.SecurityGroup {
    const sg = new ec2.SecurityGroup(this.scope, 'AlbSecurityGroup', {
      vpc: this.vpc,
      securityGroupName: this.naming.getAlbSecurityGroupName(),
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

  public createInstanceSecurityGroup(albSg: ec2.SecurityGroup): ec2.SecurityGroup {
    const sg = new ec2.SecurityGroup(this.scope, 'InstanceSecurityGroup', {
      vpc: this.vpc,
      securityGroupName: this.naming.getInstanceSecurityGroupName(),
      description: 'Security group for application instances',
      allowAllOutbound: true,
    });

    sg.addIngressRule(
      ec2.Peer.securityGroupId(albSg.securityGroupId),
      ec2.Port.tcp(this.config.appPort),
      'Allow traffic from ALB'
    );

    return sg;
  }
}

// ロードバランサーリソースの作成を管理
class LoadBalancerResources {
  constructor(
    private readonly scope: Construct,
    private readonly config: IInfraConfig,
    private readonly naming: ResourceNaming,
    private readonly vpc: ec2.Vpc,
    private readonly securityGroup: ec2.SecurityGroup
  ) {}

  public createApplicationLoadBalancer(): elbv2.ApplicationLoadBalancer {
    return new elbv2.ApplicationLoadBalancer(this.scope, this.naming.getLoadBalancerName(), {
      vpc: this.vpc,
      internetFacing: true,
      loadBalancerName: this.naming.getLoadBalancerName(),
      securityGroup: this.securityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC }
    });
  }

  public createTargetGroup(): elbv2.ApplicationTargetGroup {
    return new elbv2.ApplicationTargetGroup(this.scope, this.naming.getTargetGroupName(), {
      vpc: this.vpc,
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
}

// インフラストラクチャの出力を管理
class InfrastructureOutput {
  constructor(private readonly scope: Construct) {}

  private formatOutput(data: any): string {
    return JSON.stringify(data, null, 2);
  }

  public outputVpcInfo(vpc: ec2.Vpc): void {
    new cdk.CfnOutput(this.scope, 'VpcInfo', {
      value: this.formatOutput({
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
      }),
      description: 'VPC Information'
    });
  }

  public outputLoadBalancerInfo(alb: elbv2.ApplicationLoadBalancer): void {
    new cdk.CfnOutput(this.scope, 'LoadBalancerInfo', {
      value: this.formatOutput({
        dnsName: alb.loadBalancerDnsName,
        url: `http://${alb.loadBalancerDnsName}`,
        healthCheckUrl: `http://${alb.loadBalancerDnsName}/health`
      }),
      description: 'Load Balancer Information'
    });
  }

  public outputSecurityGroupInfo(
    albSg: ec2.SecurityGroup,
    instanceSg: ec2.SecurityGroup,
    appPort: number
  ): void {
    new cdk.CfnOutput(this.scope, 'SecurityGroupInfo', {
      value: this.formatOutput({
        loadBalancer: {
          id: albSg.securityGroupId,
          ingressRules: ['80 from 0.0.0.0/0']
        },
        instance: {
          id: instanceSg.securityGroupId,
          ingressRules: [`${appPort} from ALB`]
        }
      }),
      description: 'Security Group Information'
    });
  }
}

// メインのスタッククラス
export class InfraAwsCdkVpcAlbPriFixStack extends cdk.Stack {
  private readonly config: InfraConfig;
  private readonly naming: ResourceNaming;
  private readonly output: InfrastructureOutput;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      ...props,
      env: { region: 'ap-northeast-1' },
    });

    // 基本コンポーネントの初期化
    this.config = new InfraConfig();
    this.naming = new ResourceNaming(this.config);
    this.output = new InfrastructureOutput(this);

    // 設定の検証
    this.validateConfiguration();

    // インフラストラクチャの構築
    this.createInfrastructure();
  }

  private validateConfiguration(): void {
    if (!this.config.validateCidrRanges()) {
      throw new Error('Invalid CIDR ranges in configuration');
    }
    if (!this.config.validatePortRange()) {
      throw new Error('Invalid port number in configuration');
    }
    if (!this.config.validateRegion()) {
      throw new Error('Invalid region in configuration');
    }
  }

  private createInfrastructure(): void {
    // VPCの作成
    const vpcFactory = new VpcFactory(this, this.config, this.naming);
    const vpc = vpcFactory.create();

    // セキュリティグループの作成
    const sgFactory = new SecurityGroupFactory(this, this.config, this.naming, vpc);
    const albSg = sgFactory.createLoadBalancerSecurityGroup();
    const instanceSg = sgFactory.createInstanceSecurityGroup(albSg);

    // ロードバランサーの作成
    const lbFactory = new LoadBalancerResources(this, this.config, this.naming, vpc, albSg);
    const alb = lbFactory.createApplicationLoadBalancer();
    const targetGroup = lbFactory.createTargetGroup();

    // リスナーの作成
    alb.addListener('HttpListener', {
      port: 80,
      defaultTargetGroups: [targetGroup],
    });

    // 出力の生成
    this.output.outputVpcInfo(vpc);
    this.output.outputLoadBalancerInfo(alb);
    this.output.outputSecurityGroupInfo(albSg, instanceSg, this.config.appPort);
  }
}
