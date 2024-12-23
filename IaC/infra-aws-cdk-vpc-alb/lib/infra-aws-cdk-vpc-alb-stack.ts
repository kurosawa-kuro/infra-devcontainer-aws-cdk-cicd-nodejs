import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

// インフラストラクチャリソースの設定を管理
interface IInfraConfig {
  readonly prefix: string;
  readonly region: string;
  readonly appPort: number;
  readonly vpcCidr: string;
  readonly publicSubnet1Cidr: string;
  readonly publicSubnet2Cidr: string;
  readonly healthCheckPath: string;
}

// リソース名の生成を管理
interface IResourceNaming {
  getVpcName(): string;
  getSecurityGroupName(): string;
  getLoadBalancerName(): string;
  getTargetGroupName(): string;
  getSubnetName(az: string): string;
  getInternetGatewayName(): string;
  getRouteTableName(): string;
}

// インフラストラクチャの設定と命名を管理するクラス
class InfrastructureConfig implements IInfraConfig, IResourceNaming {
  public readonly prefix = 'cdk-vpc-js-express-ejs-8080';
  public readonly region = 'ap-northeast-1';
  public readonly appPort = 8080;
  public readonly vpcCidr = '10.0.0.0/16';
  public readonly publicSubnet1Cidr = '10.0.10.0/24';
  public readonly publicSubnet2Cidr = '10.0.11.0/24';
  public readonly healthCheckPath = '/health';

  public getVpcName(): string { return `${this.prefix}-vpc`; }
  public getSecurityGroupName(): string { return `${this.prefix}-sg-web`; }
  public getLoadBalancerName(): string { return `${this.prefix}-elb`; }
  public getTargetGroupName(): string { return `${this.prefix}-tg-alb`; }
  public getSubnetName(az: string): string { return `${this.prefix}-subnet-pub-${az}`; }
  public getInternetGatewayName(): string { return `${this.prefix}-igw`; }
  public getRouteTableName(): string { return `${this.prefix}-rtb-pub`; }
}

// CloudFormation出力の管理
class InfrastructureOutput {
  constructor(private readonly scope: Construct) {}

  public outputConfig(config: IInfraConfig): void {
    new cdk.CfnOutput(this.scope, 'StackConfig', {
      value: JSON.stringify({
        prefix: config.prefix,
        region: config.region,
        appPort: config.appPort,
        vpcCidr: config.vpcCidr,
      }, null, 2),
      description: 'Stack Configuration',
    });
  }

  public outputVpcInfo(vpc: ec2.Vpc, config: IInfraConfig): void {
    new cdk.CfnOutput(this.scope, 'VpcId', {
      value: vpc.vpcId,
      description: 'VPC ID',
    });
    new cdk.CfnOutput(this.scope, 'PublicSubnets', {
      value: vpc.publicSubnets.map(subnet => subnet.subnetId).join(', '),
      description: 'Public Subnet IDs',
    });
    new cdk.CfnOutput(this.scope, 'VpcCidr', {
      value: config.vpcCidr,
      description: 'VPC CIDR',
    });
  }

  public outputSecurityGroupInfo(securityGroup: ec2.SecurityGroup): void {
    new cdk.CfnOutput(this.scope, 'SecurityGroupId', {
      value: securityGroup.securityGroupId,
      description: 'Security Group ID',
    });
  }

  public outputLoadBalancerInfo(alb: elbv2.ApplicationLoadBalancer): void {
    new cdk.CfnOutput(this.scope, 'LoadBalancerDnsName', {
      value: alb.loadBalancerDnsName,
      description: 'Load Balancer DNS Name',
    });
  }
}

// ネットワークリソースの作成を管理
class NetworkResourceFactory {
  private albSecurityGroup?: ec2.SecurityGroup;

  constructor(
    private readonly scope: Construct,
    private readonly config: InfrastructureConfig,
    private readonly output: InfrastructureOutput
  ) {}

  public createVpc(): ec2.Vpc {
    const vpc = new ec2.Vpc(this.scope, this.config.getVpcName(), {
      vpcName: this.config.getVpcName(),
      ipAddresses: ec2.IpAddresses.cidr(this.config.vpcCidr),
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        }
      ],
    });

    this.output.outputVpcInfo(vpc, this.config);
    return vpc;
  }

  public createSecurityGroups(vpc: ec2.Vpc): { instanceSecurityGroup: ec2.SecurityGroup; loadBalancerSecurityGroup: ec2.SecurityGroup } {
    // ALB用のセキュリティグループを作成
    const loadBalancerSecurityGroup = new ec2.SecurityGroup(this.scope, 'AlbSecurityGroup', {
      vpc,
      securityGroupName: `${this.config.prefix}-alb-sg`,
      description: 'Security group for Application Load Balancer',
      allowAllOutbound: true,
    });

    // ALBの80番ポートを公開
    loadBalancerSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow inbound HTTP traffic on port 80'
    );

    // EC2インスタンス用のセキュリティグループを作成
    const instanceSecurityGroup = new ec2.SecurityGroup(this.scope, this.config.getSecurityGroupName(), {
      vpc,
      securityGroupName: this.config.getSecurityGroupName(),
      description: 'Security group for Express.js application',
      allowAllOutbound: true,
    });

    // EC2インスタンスのセキュリティグループにALBからの通信を許可
    instanceSecurityGroup.addIngressRule(
      ec2.Peer.securityGroupId(loadBalancerSecurityGroup.securityGroupId),
      ec2.Port.tcp(this.config.appPort),
      'Allow traffic from ALB to EC2 instances'
    );

    // SSH接続用ポート
    instanceSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      'Allow inbound SSH traffic on port 22'
    );

    this.output.outputSecurityGroupInfo(instanceSecurityGroup);
    this.albSecurityGroup = loadBalancerSecurityGroup;

    return {
      instanceSecurityGroup,
      loadBalancerSecurityGroup
    };
  }
}

// ロードバランサーリソースの作成を管理
class LoadBalancerFactory {
  constructor(
    private readonly scope: Construct,
    private readonly config: InfrastructureConfig,
    private readonly output: InfrastructureOutput
  ) {}

  public createApplicationLoadBalancer(
    vpc: ec2.Vpc,
    albSecurityGroup: ec2.SecurityGroup
  ): elbv2.ApplicationLoadBalancer {
    const alb = new elbv2.ApplicationLoadBalancer(this.scope, this.config.getLoadBalancerName(), {
      vpc,
      internetFacing: true,
      loadBalancerName: this.config.getLoadBalancerName(),
      securityGroup: albSecurityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC }
    });

    const targetGroup = this.createTargetGroup(vpc);
    this.createListener(alb, targetGroup);
    this.output.outputLoadBalancerInfo(alb);
    return alb;
  }

  private createTargetGroup(vpc: ec2.Vpc): elbv2.ApplicationTargetGroup {
    return new elbv2.ApplicationTargetGroup(this.scope, this.config.getTargetGroupName(), {
      vpc,
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

  private createListener(
    alb: elbv2.ApplicationLoadBalancer,
    targetGroup: elbv2.ApplicationTargetGroup
  ): void {
    alb.addListener('HttpListener', {
      port: 80,
      defaultTargetGroups: [targetGroup],
    });
  }
}

// インフラストラクチャスタックのオーケストレーション
export class InfraAwsCdkVpcAlbStack extends cdk.Stack {
  private readonly config: InfrastructureConfig;
  private readonly output: InfrastructureOutput;
  private readonly networkFactory: NetworkResourceFactory;
  private readonly loadBalancerFactory: LoadBalancerFactory;

  private vpc: ec2.Vpc;
  private instanceSecurityGroup: ec2.SecurityGroup;
  private loadBalancerSecurityGroup: ec2.SecurityGroup;
  private alb: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      ...props,
      env: { region: new InfrastructureConfig().region },
    });

    // コンポーネントの初期化
    this.config = new InfrastructureConfig();
    this.output = new InfrastructureOutput(this);
    this.networkFactory = new NetworkResourceFactory(this, this.config, this.output);
    this.loadBalancerFactory = new LoadBalancerFactory(this, this.config, this.output);

    // インフラストラクチャの構築
    this.output.outputConfig(this.config);
    this.createInfrastructure();
  }

  private createInfrastructure(): void {
    this.vpc = this.networkFactory.createVpc();
    const securityGroups = this.networkFactory.createSecurityGroups(this.vpc);
    this.instanceSecurityGroup = securityGroups.instanceSecurityGroup;
    this.loadBalancerSecurityGroup = securityGroups.loadBalancerSecurityGroup;
    
    this.alb = this.loadBalancerFactory.createApplicationLoadBalancer(
      this.vpc,
      this.loadBalancerSecurityGroup
    );
  }

  // パブリックインターフェース
  public getVpc(): ec2.Vpc {
    return this.vpc;
  }

  public getInstanceSecurityGroup(): ec2.SecurityGroup {
    return this.instanceSecurityGroup;
  }

  public getLoadBalancerSecurityGroup(): ec2.SecurityGroup {
    return this.loadBalancerSecurityGroup;
  }

  public getAlb(): elbv2.ApplicationLoadBalancer {
    return this.alb;
  }
}
