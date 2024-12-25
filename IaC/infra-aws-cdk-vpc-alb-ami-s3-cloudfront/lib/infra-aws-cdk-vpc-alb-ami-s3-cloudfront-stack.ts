import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';

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
  cloudfront: {
    comment: 'CDN for S3 static content',
  },
} as const;

export class InfraAwsCdkVpcAlbAmiS3CloudfrontStack extends cdk.Stack {
  private readonly app: cdk.App;
  private readonly vpc: ec2.Vpc;
  private readonly albSg: ec2.SecurityGroup;
  private readonly appSg: ec2.SecurityGroup;
  private readonly instance: ec2.Instance;
  private readonly alb: elbv2.ApplicationLoadBalancer;
  private readonly bucket: s3.Bucket;
  private readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      ...props,
      env: { region: CONFIG.region },
      crossRegionReferences: true,
    });

    this.app = scope as cdk.App;

    // VPC and Network
    this.vpc = this.createVpc();
    const { albSg, appSg } = this.createSecurityGroups();
    this.albSg = albSg;
    this.appSg = appSg;

    // Compute and Load Balancing
    this.instance = this.createEc2Instance();
    this.alb = this.createAlb();
    const targetGroup = this.createTargetGroup();
    this.configureAlbListener(targetGroup);

    // Storage and CDN
    this.bucket = this.createS3Bucket();
    const webAcl = this.createWebAcl();
    this.distribution = this.createCloudFrontDistribution(webAcl);

    this.addOutputs();
  }

  private createVpc(): ec2.Vpc {
    return new ec2.Vpc(this, 'AppVpc', {
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
  }

  private createSecurityGroups() {
    const albSg = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc: this.vpc,
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
      vpc: this.vpc,
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

    return { albSg, appSg };
  }

  private createEc2Instance(): ec2.Instance {
    return new ec2.Instance(this, 'AppInstance', {
      vpc: this.vpc,
      instanceType: CONFIG.app.instanceType,
      machineImage: ec2.MachineImage.genericLinux({
        [CONFIG.region]: CONFIG.app.ami,
      }),
      securityGroup: this.appSg,
      keyPair: ec2.KeyPair.fromKeyPairName(this, 'KeyPair', CONFIG.app.keyName),
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceName: `${CONFIG.prefix}-ec2`,
      blockDevices: [{
        deviceName: '/dev/xvda',
        volume: ec2.BlockDeviceVolume.ebs(CONFIG.app.volumeSize),
      }],
    });
  }

  private createAlb(): elbv2.ApplicationLoadBalancer {
    return new elbv2.ApplicationLoadBalancer(this, 'AppLoadBalancer', {
      vpc: this.vpc,
      internetFacing: true,
      loadBalancerName: `${CONFIG.prefix}-alb`,
      securityGroup: this.albSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC }
    });
  }

  private createTargetGroup(): elbv2.ApplicationTargetGroup {
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'AppTargetGroup', {
      vpc: this.vpc,
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

    targetGroup.addTarget(new targets.InstanceTarget(this.instance));
    return targetGroup;
  }

  private configureAlbListener(targetGroup: elbv2.ApplicationTargetGroup): void {
    this.alb.addListener('HttpListener', {
      port: 80,
      defaultTargetGroups: [targetGroup],
    });
  }

  private createS3Bucket(): s3.Bucket {
    return new s3.Bucket(this, 'StaticContentBucket', {
      bucketName: `${CONFIG.prefix}-s3`,
      autoDeleteObjects: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      cors: [{
        allowedHeaders: ['*'],
        allowedMethods: [
          s3.HttpMethods.GET,
          s3.HttpMethods.PUT,
          s3.HttpMethods.POST,
          s3.HttpMethods.DELETE,
        ],
        allowedOrigins: ['*'],
        exposedHeaders: [],
      }],
    });
  }

  private createWebAcl(): wafv2.CfnWebACL {
    // Create the WebACL in us-east-1 for CloudFront
    const webAclStack = new cdk.Stack(this.app, 'WebAclStack', {
      env: { region: 'us-east-1' },
      crossRegionReferences: true,
    });

    return new wafv2.CfnWebACL(webAclStack, 'CloudFrontWebAcl', {
      defaultAction: { allow: {} },
      scope: 'CLOUDFRONT',
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `${CONFIG.prefix}-cf-waf-metric`,
        sampledRequestsEnabled: true,
      },
      rules: [],
      name: `${CONFIG.prefix}-cf-waf`,
      description: 'WAF rules for CloudFront distribution'
    });
  }

  private createCloudFrontDistribution(webAcl: wafv2.CfnWebACL): cloudfront.Distribution {
    return new cloudfront.Distribution(this, 'StaticContentDistribution', {
      defaultBehavior: {
        origin: new origins.HttpOrigin(`${this.bucket.bucketName}.s3.${CONFIG.region}.amazonaws.com`, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      webAclId: webAcl.attrArn,
      comment: CONFIG.cloudfront.comment,
    });
  }

  private addOutputs(): void {
    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      description: 'VPC ID',
    });

    new cdk.CfnOutput(this, 'InstanceId', {
      value: this.instance.instanceId,
      description: 'EC2 Instance ID',
    });

    new cdk.CfnOutput(this, 'InstancePublicIp', {
      value: this.instance.instancePublicIp,
      description: 'EC2 Instance Public IP',
    });

    new cdk.CfnOutput(this, 'LoadBalancerDns', {
      value: this.alb.loadBalancerDnsName,
      description: 'ALB DNS Name',
    });

    new cdk.CfnOutput(this, 'BucketName', {
      value: this.bucket.bucketName,
      description: 'S3 Bucket Name',
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront Distribution ID',
    });

    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront Distribution Domain Name',
    });

    new cdk.CfnOutput(this, 'StorageS3Bucket', {
      value: `STORAGE_S3_BUCKET=${this.bucket.bucketName}`,
      description: 'Environment variable for S3 bucket name',
    });

    new cdk.CfnOutput(this, 'StorageCdnUrl', {
      value: `STORAGE_CDN_URL=https://${this.distribution.distributionDomainName}`,
      description: 'Environment variable for CloudFront URL',
    });

    new cdk.CfnOutput(this, 'StorageCdnDistributionId', {
      value: `STORAGE_CDN_DISTRIBUTION_ID=${this.distribution.distributionId}`,
      description: 'Environment variable for CloudFront Distribution ID',
    });
  }
}
