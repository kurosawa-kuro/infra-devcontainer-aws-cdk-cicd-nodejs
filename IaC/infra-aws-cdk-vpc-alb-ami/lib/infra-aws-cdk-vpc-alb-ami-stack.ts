import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';

// 設定値を一箇所で管理
const CONFIG = {
  prefix: 'cdk-vpc-js-express-ejs-8080',
  region: 'ap-northeast-1',
  vpc: {
    cidr: '10.0.0.0/16',
    maxAzs: 2,
    subnetMask: 24,
  },
  app: {
    port: 8080,
    healthCheckPath: '/health',
    ami: 'ami-0782bb976c68e3fb6',
    instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO),
    keyName: 'training-ec2',
    volumeSize: 10,
  },
  healthCheck: {
    healthyThreshold: 2,
    unhealthyThreshold: 2,
    timeout: 5,
    interval: 30,
  },
} as const;

export class InfraAwsCdkVpcAlbAmiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      ...props,
      env: { region: CONFIG.region },
    });

    // VPCの作成
    const vpc = new ec2.Vpc(this, 'AppVpc', {
      vpcName: `${CONFIG.prefix}-vpc`,
      ipAddresses: ec2.IpAddresses.cidr(CONFIG.vpc.cidr),
      maxAzs: CONFIG.vpc.maxAzs,
      natGateways: 0,
      subnetConfiguration: [{
        name: 'Public',
        subnetType: ec2.SubnetType.PUBLIC,
        mapPublicIpOnLaunch: true,
        cidrMask: CONFIG.vpc.subnetMask
      }],
    });

    // セキュリティグループの作成
    const albSg = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc,
      securityGroupName: `${CONFIG.prefix}-alb-sg`,
      description: 'Security group for ALB',
      allowAllOutbound: true,
    });

    albSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP'
    );

    const appSg = new ec2.SecurityGroup(this, 'AppSecurityGroup', {
      vpc,
      securityGroupName: `${CONFIG.prefix}-app-sg`,
      description: 'Security group for App',
      allowAllOutbound: true,
    });

    appSg.addIngressRule(
      ec2.Peer.securityGroupId(albSg.securityGroupId),
      ec2.Port.tcp(CONFIG.app.port),
      'Allow from ALB'
    );

    appSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      'Allow SSH'
    );

    // EC2インスタンスの作成
    const instance = new ec2.Instance(this, 'AppInstance', {
      vpc,
      instanceType: CONFIG.app.instanceType,
      machineImage: ec2.MachineImage.genericLinux({
        [CONFIG.region]: CONFIG.app.ami,
      }),
      securityGroup: appSg,
      keyName: CONFIG.app.keyName,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceName: `${CONFIG.prefix}-ec2`,
      blockDevices: [{
        deviceName: '/dev/xvda',
        volume: ec2.BlockDeviceVolume.ebs(CONFIG.app.volumeSize),
      }],
    });

    // ALBの作成
    const alb = new elbv2.ApplicationLoadBalancer(this, 'AppLoadBalancer', {
      vpc,
      internetFacing: true,
      loadBalancerName: `${CONFIG.prefix}-alb`,
      securityGroup: albSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC }
    });

    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'AppTargetGroup', {
      vpc,
      port: CONFIG.app.port,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.INSTANCE,
      healthCheck: {
        path: CONFIG.app.healthCheckPath,
        port: 'traffic-port',
        healthyThresholdCount: CONFIG.healthCheck.healthyThreshold,
        unhealthyThresholdCount: CONFIG.healthCheck.unhealthyThreshold,
        timeout: cdk.Duration.seconds(CONFIG.healthCheck.timeout),
        interval: cdk.Duration.seconds(CONFIG.healthCheck.interval),
      }
    });

    targetGroup.addTarget(new targets.InstanceTarget(instance));
    alb.addListener('HttpListener', {
      port: 80,
      defaultTargetGroups: [targetGroup],
    });

    // CloudFormation出力の作成
    new cdk.CfnOutput(this, 'VpcId', {
      value: vpc.vpcId,
      description: 'VPC ID',
    });

    new cdk.CfnOutput(this, 'InstanceId', {
      value: instance.instanceId,
      description: 'EC2 Instance ID',
    });

    new cdk.CfnOutput(this, 'InstancePublicIp', {
      value: instance.instancePublicIp,
      description: 'EC2 Instance Public IP',
    });

    new cdk.CfnOutput(this, 'LoadBalancerDns', {
      value: alb.loadBalancerDnsName,
      description: 'ALB DNS Name',
    });
  }
}
