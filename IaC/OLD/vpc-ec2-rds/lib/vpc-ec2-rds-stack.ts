import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as elbv2_targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as fs from 'fs';

// ==========================================
// 環境設定（頻繁に変更する設定）
// ==========================================
const ENVIRONMENT = 'training-03';
const FEATURES = {
  enableRds: false,  // RDSインスタンスの有効/無効
};
// ==========================================

// 1. 設定関連のクラスをまとめる
namespace Config {
  // 基本設定の型定義
  export namespace Types {
    // 既存のConfigsネームスペースの内容をここに移動
    export interface VpcConfig {
      vpcName: string;
      vpcCidr: string;
      publicSubnets: SubnetConfig[];
      privateSubnets: SubnetConfig[];
    }

    export interface SubnetConfig {
      name: string;
      az: string;
      cidr: string;
    }

    export interface SecurityGroupRule {
      port: number;
      source: string;
      description: string;
    }

    export interface SecurityGroupConfig {
      webServer: {
        name: string;
        ingressRules: SecurityGroupRule[];
      };
      database: {
        name: string;
        ingressRules: SecurityGroupRule[];
      };
      alb: {
        name: string;
        ingressRules: SecurityGroupRule[];
      };
    }

    export interface EC2Config {
      name: string;
      instanceType: ec2.InstanceType;
      keyName: string;
    }

    export interface RDSConfig {
      instanceIdentifier: string;
      databaseName: string;
      username: string;
      password: string;
    }

    export interface ALBConfig {
      name: string;
      targetGroupName: string;
      healthCheckPath: string;
    }

    export interface S3Config {
      bucketName: string;
      cors: {
        allowedOrigins: string[];
        allowedMethods: string[];
        allowedHeaders: string[];
      };
    }

    export interface FeatureFlags {
      enableRds: boolean;
    }
  }

  // 環境設定管理
  export class Environment {
    static readonly ENV = ENVIRONMENT;
    
    static getEnv(): string {
      return this.ENV;
    }

    static getResourceName(resourceType: string, suffix?: string): string {
      return `${this.ENV}-${resourceType}${suffix ? `-${suffix}` : ''}`;
    }

    static readonly region = {
      primary: 'ap-northeast-1',
      availabilityZones: ['ap-northeast-1a', 'ap-northeast-1c'],
    };
  }

  // インフラ設定管理
  export class Infrastructure {
    static readonly vpc: Types.VpcConfig = {
      vpcName: Environment.getResourceName('vpc'),
      vpcCidr: '10.0.0.0/16',
      publicSubnets: [
        {
          name: Environment.getResourceName('subnet-pub', '1a'),
          az: Environment.region.availabilityZones[0],
          cidr: '10.0.10.0/24',
        },
        {
          name: Environment.getResourceName('subnet-pub', '1c'),
          az: Environment.region.availabilityZones[1],
          cidr: '10.0.11.0/24',
        }
      ],
      privateSubnets: [
        {
          name: Environment.getResourceName('subnet-pri', '1a'),
          az: Environment.region.availabilityZones[0],
          cidr: '10.0.20.0/24',
        },
        {
          name: Environment.getResourceName('subnet-pri', '1c'),
          az: Environment.region.availabilityZones[1],
          cidr: '10.0.21.0/24',
        }
      ]
    };

    static readonly securityGroups: Types.SecurityGroupConfig = {
      webServer: {
        name: Environment.getResourceName('sg-web'),
        ingressRules: [
          { port: 22, source: '0.0.0.0/0', description: 'Allow SSH' },
          { port: 80, source: '0.0.0.0/0', description: 'Allow HTTP' },
        ],
      },
      database: {
        name: Environment.getResourceName('sg-db'),
        ingressRules: [
          { port: 5432, source: 'sg-web', description: 'Allow PostgreSQL from web server' },
        ],
      },
      alb: {
        name: Environment.getResourceName('sg-alb'),
        ingressRules: [
          { port: 80, source: '0.0.0.0/0', description: 'Allow HTTP from anywhere' },
        ],
      },
    };

    static readonly compute = {
      ec2: {
        name: Environment.getResourceName('instance-web'),
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO),
        keyName: Environment.getResourceName('key-web'),
      },
      rds: {
        instanceIdentifier: Environment.getResourceName('instance-postgresql'),
        databaseName: 'training',
        username: 'postgres',
        password: 'postgres',
      },
      alb: {
        name: Environment.getResourceName('alb'),
        targetGroupName: Environment.getResourceName('tg'),
        healthCheckPath: '/api/health',
      }
    };

    static readonly storage = {
      s3: {
        bucketName: Environment.getResourceName('bucket'),
        cors: {
          allowedOrigins: ['*'],
          allowedMethods: ['GET', 'POST', 'PUT'],
          allowedHeaders: ['*'],
        }
      }
    };

    static readonly features: Types.FeatureFlags = FEATURES;
  }
}

// 2. リソースビルダー関連をまとめる
namespace ResourceBuilders {
  // 基底ビルダー
  export abstract class Base {
    constructor(protected readonly scope: Construct) {}
    abstract build(): any;
  }

  // 各リソース用ビルダー
  export class Vpc extends Base {
    private vpc: ec2.Vpc;
    
    constructor(scope: Construct, private readonly config: Config.Types.VpcConfig) {
      super(scope);
    }

    build(): ec2.Vpc {
      this.createVpc();
      this.tagResources();
      return this.vpc;
    }

    private createVpc() {
      this.vpc = new ec2.Vpc(this.scope, this.config.vpcName, {
        ipAddresses: ec2.IpAddresses.cidr(this.config.vpcCidr),
        maxAzs: 2,
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
          },
          {
            name: 'Private',
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            cidrMask: 24,
          },
        ],
      });
    }

    private tagResources() {
      // VPCタグ
      cdk.Tags.of(this.vpc).add('Name', this.config.vpcName);

      // IGWタグ
      const igw = this.vpc.node.findChild('IGW') as ec2.CfnInternetGateway;
      cdk.Tags.of(igw).add('Name', `${Config.Environment.ENV}-igw`);

      // サブネットタグ
      const [publicSubnet1, publicSubnet2] = this.vpc.publicSubnets;
      cdk.Tags.of(publicSubnet1).add('Name', `${Config.Environment.ENV}-subnet-pub-1a`);
      cdk.Tags.of(publicSubnet2).add('Name', `${Config.Environment.ENV}-subnet-pub-1c`);

      // ルートテーブルタグ
      const publicRouteTable = publicSubnet1.node.findChild('RouteTable') as ec2.CfnRouteTable;
      const privateRouteTable1 = this.vpc.privateSubnets[0].node.findChild('RouteTable') as ec2.CfnRouteTable;
      const privateRouteTable2 = this.vpc.privateSubnets[1].node.findChild('RouteTable') as ec2.CfnRouteTable;

      cdk.Tags.of(publicRouteTable).add('Name', `${Config.Environment.ENV}-rtb-pub`);
      cdk.Tags.of(privateRouteTable1).add('Name', `${Config.Environment.ENV}-rtb-pri`);
      cdk.Tags.of(privateRouteTable2).add('Name', `${Config.Environment.ENV}-rtb-pri`);
    }
  }

  export class SecurityGroup extends Base {
    private readonly securityGroups: {
      webServerSg?: ec2.SecurityGroup;
      dbServerSg?: ec2.SecurityGroup;
      albSg?: ec2.SecurityGroup;
    } = {};

    constructor(
      scope: Construct,
      private readonly vpc: ec2.Vpc,
      private readonly config: Config.Types.SecurityGroupConfig
    ) {
      super(scope);
    }

    build() {
      this.createWebServerSecurityGroup();
      this.createDbServerSecurityGroup();
      this.createAlbSecurityGroup();
      return this.securityGroups;
    }

    private createWebServerSecurityGroup() {
      const sg = new ec2.SecurityGroup(this.scope, 'WebServerSG', {
        vpc: this.vpc,
        securityGroupName: this.config.webServer.name,
        description: 'Security group for web server',
      });
      this.securityGroups.webServerSg = sg;

      this.config.webServer.ingressRules.forEach(rule => {
        sg.addIngressRule(
          ec2.Peer.ipv4(rule.source),
          ec2.Port.tcp(rule.port),
          rule.description
        );
      });
    }

    private createDbServerSecurityGroup() {
      this.securityGroups.dbServerSg = new ec2.SecurityGroup(this.scope, 'DBServerSG', {
        vpc: this.vpc,
        securityGroupName: this.config.database.name,
        description: 'Security group for database',
      });

      this.securityGroups.dbServerSg.addIngressRule(
        ec2.Peer.securityGroupId(this.securityGroups.webServerSg!.securityGroupId),
        ec2.Port.tcp(5432),
        'Allow PostgreSQL from web server'
      );
    }

    private createAlbSecurityGroup() {
      const sg = new ec2.SecurityGroup(this.scope, 'AlbSecurityGroup', {
        vpc: this.vpc,
        securityGroupName: this.config.alb.name,
        description: 'Security group for ALB'
      });
      this.securityGroups.albSg = sg;

      this.config.alb.ingressRules.forEach(rule => {
        sg.addIngressRule(
          ec2.Peer.ipv4(rule.source),
          ec2.Port.tcp(rule.port),
          rule.description
        );
      });
    }
  }

  export class EC2 extends Base {
    constructor(
      scope: Construct,
      private readonly vpc: ec2.Vpc,
      private readonly securityGroup: ec2.SecurityGroup,
      private readonly config: Config.Types.EC2Config
    ) {
      super(scope);
    }

    private createUserData(): ec2.UserData {
      const userData = ec2.UserData.forLinux();
      
      // プレイブックの内容をBase64エンコード
      const playbookContent = fs.readFileSync('assets/ansible/playbooks/main.yml', 'utf8');
      const encodedPlaybook = Buffer.from(playbookContent).toString('base64');
      
      // テェック用プレイブックの内容をBase64エンコード
      const checkPlaybookContent = fs.readFileSync('assets/ansible/playbooks/check-installation.yml', 'utf8');
      const encodedCheckPlaybook = Buffer.from(checkPlaybookContent).toString('base64');
      
      // テンプレートファイルの内容をBase64��ンコード
      const nginxConfTemplate = fs.readFileSync('assets/ansible/templates/nginx.conf.j2').toString('base64');
      const pgHbaConfTemplate = fs.readFileSync('assets/ansible/templates/pg_hba.conf.j2').toString('base64');
      
      userData.addCommands(
        '#!/bin/bash',
        
        // cloud-initのログ設定を確認
        'exec > >(tee /var/log/user-data.log | logger -t user-data -s 2>/dev/console) 2>&1',
        
        'echo "=== Starting UserData script execution ==="',
        'date "+%Y-%m-%d %H:%M:%S"',
        
        // デバッグモード
        'set -x',
        
        // システムアップデートとAnsibleインストール
        'echo "=== Installing required packages ==="',
        'dnf update -y',
        'dnf install -y ansible-core',
        
        // Ansibleコレクションのインストール
        'echo "=== Installing Ansible collections ==="',
        'ansible-galaxy collection install community.general',
        
        // ディレクトリの作成
        'echo "=== Creating Ansible directories ==="',
        'mkdir -p /etc/ansible/playbooks',
        'mkdir -p /etc/ansible/templates',
        'chmod 755 /etc/ansible/playbooks',
        'chmod 755 /etc/ansible/templates',
        
        // テンプレートファイルの配置
        'echo "=== Deploying template files ==="',
        `echo "${nginxConfTemplate}" | base64 -d > /etc/ansible/templates/nginx.conf.j2`,
        `echo "${pgHbaConfTemplate}" | base64 -d > /etc/ansible/templates/pg_hba.conf.j2`,
        'chmod 644 /etc/ansible/templates/nginx.conf.j2',
        'chmod 644 /etc/ansible/templates/pg_hba.conf.j2',
        
        // プレイブックの配置
        'echo "=== Deploying Ansible playbooks ==="',
        'echo "Creating playbook files..."',
        `echo "${encodedPlaybook}" | base64 -d > /etc/ansible/playbooks/main.yml`,
        `echo "${encodedCheckPlaybook}" | base64 -d > /etc/ansible/playbooks/check-installation.yml`,
        'chmod 644 /etc/ansible/playbooks/main.yml',
        'chmod 644 /etc/ansible/playbooks/check-installation.yml',
        
        // プレイブックの内容確認
        'echo "=== Verifying playbook contents ==="',
        'ls -l /etc/ansible/playbooks/',
        'cat /etc/ansible/playbooks/main.yml',
        'cat /etc/ansible/playbooks/check-installation.yml',
        
        // Ansibleの実行
        'echo "=== Running Ansible playbook ==="',
        'ANSIBLE_LOG_PATH=/var/log/ansible.log ansible-playbook -i localhost, -c local /etc/ansible/playbooks/main.yml -v',
        
        'echo "=== UserData script completed ==="',
        'date "+%Y-%m-%d %H:%M:%S"'
      );

      return userData;
    }

    private createIamRole(): iam.Role {
      const role = new iam.Role(this.scope, 'EC2Role', {
        roleName: Config.Environment.getResourceName('role-ec2'),
        assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
        description: 'Role for EC2 instance to access AWS services',
      });

      role.addToPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          's3:GetObject',
          's3:PutObject',
          's3:ListBucket',
          's3:DeleteObject'
        ],
        resources: [
          `arn:aws:s3:::${Config.Infrastructure.storage.s3.bucketName}`,
          `arn:aws:s3:::${Config.Infrastructure.storage.s3.bucketName}/*`
        ],
      }));

      // Systems Manager用のポリシー
      role.addManagedPolicy(
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')
      );

      return role;
    }

    build(): ec2.Instance {
      const role = this.createIamRole();
      
      const instance = new ec2.Instance(this.scope, 'WebServer', {
        vpc: this.vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
        instanceType: this.config.instanceType,
        machineImage: ec2.MachineImage.latestAmazonLinux2023(),
        securityGroup: this.securityGroup,
        keyName: this.config.keyName,
        userData: this.createUserData(),
        role: role,
        blockDevices: [{
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(20),
        }],
      });

      new ec2.CfnEIP(this.scope, 'WebServerEIP', {
        instanceId: instance.instanceId,
        tags: [{ key: 'Name', value: `${Config.Environment.ENV}-eip-web` }],
      });

      return instance;
    }
  }

  export class RDS extends Base {
    constructor(
      scope: Construct,
      private readonly vpc: ec2.Vpc,
      private readonly securityGroup: ec2.SecurityGroup,
      private readonly config: Config.Types.RDSConfig
    ) {
      super(scope);
    }

    build(): rds.DatabaseInstance {
      const parameterGroup = this.createParameterGroup();
      const subnetGroup = this.createSubnetGroup();

      return new rds.DatabaseInstance(this.scope, 'PostgresqlInstance', {
        engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_12 }),
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
        vpc: this.vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          availabilityZones: ['ap-northeast-1a', 'ap-northeast-1c']
        },
        multiAz: true,
        securityGroups: [this.securityGroup],
        parameterGroup,
        subnetGroup,
        instanceIdentifier: this.config.instanceIdentifier,
        credentials: {
          username: this.config.username,
          password: cdk.SecretValue.unsafePlainText(this.config.password),
        },
        databaseName: this.config.databaseName,
        allocatedStorage: 20,
        maxAllocatedStorage: 20,
        allowMajorVersionUpgrade: false,
        autoMinorVersionUpgrade: false,
        backupRetention: cdk.Duration.days(1),
        deleteAutomatedBackups: true,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        publiclyAccessible: false,
      });
    }

    private createParameterGroup(): rds.ParameterGroup {
      const group = new rds.ParameterGroup(this.scope, 'PostgresqlParameterGroup', {
        engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_12 }),
        description: 'Parameter group for postgresql12',
        parameters: {},
      });
      cdk.Tags.of(group).add('Name', `${Config.Environment.ENV}-rds-param-postgresql`);
      return group;
    }

    private createSubnetGroup(): rds.SubnetGroup {
      return new rds.SubnetGroup(this.scope, 'PostgresqlSubnetGroup', {
        description: 'Subnet group for postgresql',
        vpc: this.vpc,
        subnetGroupName: `${Config.Environment.ENV}-rds-subnet-group`,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          availabilityZones: ['ap-northeast-1a', 'ap-northeast-1c']
        }
      });
    }
  }

  export class S3 extends Base {
    constructor(
      scope: Construct,
      private readonly config: Config.Types.S3Config
    ) {
      super(scope);
    }

    build(): s3.Bucket {
      return new s3.Bucket(this.scope, 'UploadBucket', {
        bucketName: this.config.bucketName,
        publicReadAccess: false,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
        cors: [{
          allowedOrigins: this.config.cors.allowedOrigins,
          allowedMethods: this.config.cors.allowedMethods.map(method => 
            s3.HttpMethods[method as keyof typeof s3.HttpMethods]
          ),
          allowedHeaders: this.config.cors.allowedHeaders,
        }],
      });
    }
  }
}

// 3. インフラ出力管理
class InfrastructureOutput {
  constructor(private readonly scope: cdk.Stack) {}

  create(
    ec2Instance: ec2.Instance,
    rdsInstance: rds.DatabaseInstance | undefined,
    s3Bucket: s3.Bucket
  ): void {
    new cdk.CfnOutput(this.scope, 'EC2PublicDNS', {
      value: ec2Instance.instancePublicDnsName,
      description: 'EC2 Instance Public DNS',
    });

    new cdk.CfnOutput(this.scope, 'EC2PublicIP', {
      value: ec2Instance.instancePublicIp,
      description: 'EC2 Instance Public IP',
    });

    if (rdsInstance) {
      new cdk.CfnOutput(this.scope, 'RDSEndpoint', {
        value: rdsInstance.instanceEndpoint.hostname,
        description: 'RDS Instance Endpoint',
      });
    }

    new cdk.CfnOutput(this.scope, 'S3BucketName', {
      value: s3Bucket.bucketName,
      description: 'S3 Bucket Name',
    });
  }
}

// 4. メインのスタッククラス
export class VpcEc2RdsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPCの構築
    const vpc = new ResourceBuilders.Vpc(
      this,
      Config.Infrastructure.vpc
    ).build();
    
    // セキュリティグループの構築
    const securityGroups = new ResourceBuilders.SecurityGroup(
      this,
      vpc,
      Config.Infrastructure.securityGroups
    ).build();

    // EC2インスタンスの構築
    const ec2Instance = new ResourceBuilders.EC2(
      this,
      vpc,
      securityGroups.webServerSg!,
      Config.Infrastructure.compute.ec2
    ).build();

    // RDSインスタンスの条件付き構築
    let rdsInstance: rds.DatabaseInstance | undefined;
    if (Config.Infrastructure.features.enableRds) {
      rdsInstance = new ResourceBuilders.RDS(
        this,
        vpc,
        securityGroups.dbServerSg!,
        Config.Infrastructure.compute.rds
      ).build();
    }

    // S3バケットの構築
    const s3Bucket = new ResourceBuilders.S3(
      this,
      Config.Infrastructure.storage.s3
    ).build();

    // 出力の設定も条件付きに
    new InfrastructureOutput(this).create(
      ec2Instance,
      rdsInstance,
      s3Bucket
    );
  }
}