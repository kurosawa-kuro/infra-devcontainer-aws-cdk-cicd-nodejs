import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

// 設定管理クラス
class StackConfig {
  public readonly PREFIX = 'cdk-vpc-js-express-ejs-8080';
  public readonly REGION = 'ap-northeast-1';
  public readonly APP_PORT = 8080;
  public readonly CREATE_SECURITY_GROUP = true;
  public readonly VPC_CIDR = '10.0.0.0/16';

  // リソース名生成
  public getVpcName(): string {
    return `${this.PREFIX}-vpc`;
  }

  public getSecurityGroupName(): string {
    return `${this.PREFIX}-sg`;
  }
}

// 出力管理クラス
class OutputManager {
  constructor(private readonly scope: Construct) {}

  // スタック設定の出力
  public outputStackConfig(config: StackConfig): void {
    new cdk.CfnOutput(this.scope, 'StackConfig', {
      value: JSON.stringify({
        prefix: config.PREFIX,
        region: config.REGION,
        appPort: config.APP_PORT,
        createSecurityGroup: config.CREATE_SECURITY_GROUP,
        vpcCidr: config.VPC_CIDR,
      }, null, 2),
      description: 'Stack Configuration',
    });
  }

  // VPC情報の出力
  public outputVpcInfo(vpc: ec2.Vpc, config: StackConfig): void {
    new cdk.CfnOutput(this.scope, 'VpcId', {
      value: vpc.vpcId,
      description: 'VPC ID',
    });

    new cdk.CfnOutput(this.scope, 'PublicSubnets', {
      value: vpc.publicSubnets.map(subnet => subnet.subnetId).join(', '),
      description: 'Public Subnet IDs',
    });

    new cdk.CfnOutput(this.scope, 'VpcCidr', {
      value: config.VPC_CIDR,
      description: 'VPC CIDR',
    });
  }

  // セキュリティグループ情報の出力
  public outputSecurityGroupInfo(securityGroup: ec2.SecurityGroup): void {
    new cdk.CfnOutput(this.scope, 'SecurityGroupId', {
      value: securityGroup.securityGroupId,
      description: 'Security Group ID',
    });
  }
}

// VPC作成クラス
class VpcCreator {
  constructor(
    private readonly scope: Construct,
    private readonly config: StackConfig,
    private readonly outputManager: OutputManager
  ) {}

  create(): ec2.Vpc {
    const vpc = new ec2.Vpc(this.scope, this.config.getVpcName(), {
      vpcName: this.config.getVpcName(),
      ipAddresses: ec2.IpAddresses.cidr(this.config.VPC_CIDR),
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

    this.outputManager.outputVpcInfo(vpc, this.config);
    return vpc;
  }
}

// セキュリティグループ作成クラス
class SecurityGroupCreator {
  constructor(
    private readonly scope: Construct,
    private readonly config: StackConfig,
    private readonly vpc: ec2.Vpc,
    private readonly outputManager: OutputManager
  ) {}

  create(): ec2.SecurityGroup {
    const securityGroup = new ec2.SecurityGroup(this.scope, this.config.getSecurityGroupName(), {
      vpc: this.vpc,
      securityGroupName: this.config.getSecurityGroupName(),
      description: 'Security group for Express.js application',
      allowAllOutbound: true,
    });

    this.addIngressRules(securityGroup);
    this.outputManager.outputSecurityGroupInfo(securityGroup);
    return securityGroup;
  }

  private addIngressRules(securityGroup: ec2.SecurityGroup): void {
    // アプリケーションポート
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(this.config.APP_PORT),
      `Allow inbound HTTP traffic on port ${this.config.APP_PORT}`
    );

    // SSH接続用ポート
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      'Allow inbound SSH traffic on port 22'
    );
  }
}

// メインスタッククラス
export class InfraAwsCdkVpcStack extends cdk.Stack {
  private readonly config: StackConfig;
  private readonly outputManager: OutputManager;
  private readonly vpc: ec2.Vpc;
  private readonly securityGroup?: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      ...props,
      env: {
        region: new StackConfig().REGION,
      },
    });

    // 共通コンポーネントの初期化
    this.config = new StackConfig();
    this.outputManager = new OutputManager(this);

    // スタック設定の出力
    this.outputManager.outputStackConfig(this.config);

    // VPCの作成
    const vpcCreator = new VpcCreator(this, this.config, this.outputManager);
    this.vpc = vpcCreator.create();

    // セキュリティグループの作成（フラグ制御）
    if (this.config.CREATE_SECURITY_GROUP) {
      const securityGroupCreator = new SecurityGroupCreator(
        this,
        this.config,
        this.vpc,
        this.outputManager
      );
      this.securityGroup = securityGroupCreator.create();
    }
  }

  // VPCのゲッター
  public getVpc(): ec2.Vpc {
    return this.vpc;
  }

  // セキュリティグループのゲッター
  public getSecurityGroup(): ec2.SecurityGroup | undefined {
    return this.securityGroup;
  }
}
