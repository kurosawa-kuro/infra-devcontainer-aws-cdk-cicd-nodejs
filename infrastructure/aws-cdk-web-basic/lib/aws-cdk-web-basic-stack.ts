import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as iam from 'aws-cdk-lib/aws-iam';

interface ResourceNaming {
  vpc: string;
  igw: string;
  getSubnetId: (index: number) => string;
  getRouteTableId: (index: number) => string;
  ec2: string;
  alb: string;
  s3: string;
  cloudfront: string;
}

const LOGICAL_PREFIX = 'CdkExpress01';

const CONFIG = {
  prefix: LOGICAL_PREFIX.toLowerCase(),
  region: 'ap-northeast-1',
  naming: {
    vpc: `${LOGICAL_PREFIX}Vpc`,
    igw: `${LOGICAL_PREFIX}Igw`,
    getSubnetId: (index: number) => `${LOGICAL_PREFIX}PublicSubnet${index === 0 ? '1a' : '1c'}`,
    getRouteTableId: (index: number) => `${LOGICAL_PREFIX}PublicRt${index === 0 ? '1a' : '1c'}`,
    ec2: `${LOGICAL_PREFIX}Ec2`,
    alb: `${LOGICAL_PREFIX}Alb`,
    s3: `${LOGICAL_PREFIX}S3`,
    cloudfront: `${LOGICAL_PREFIX}Cf`
  } as ResourceNaming,
  vpc: {
    cidr: '10.0.0.0/16',
    maxAzs: 2,
    subnetMask: 24,
  },
  app: {
    port: 8080,
    healthCheckPath: '/health',
    ami: 'ami-0d6308af452376e20',
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
    cacheDuration: {
      default: cdk.Duration.days(1),
      max: cdk.Duration.days(365),
      min: cdk.Duration.hours(1),
    }
  },
} as const;


export class AwsCdkWebBasicStack extends cdk.Stack {
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

    // Infrastructure Creation
    this.vpc = this.createVpc();
    const securityGroups = this.createSecurityGroups();
    this.albSg = securityGroups.albSg;
    this.appSg = securityGroups.appSg;

    // Application Components
    this.instance = this.createEc2Instance();
    this.alb = this.createLoadBalancer();
    this.configureLoadBalancer();

    // Storage and CDN
    this.bucket = this.createS3Bucket();
    const webAcl = this.createWebAcl();
    this.distribution = this.createCloudFrontDistribution(webAcl);

    this.addOutputs();
  }

  private createVpc(): ec2.Vpc {
    const vpc = new ec2.Vpc(this, CONFIG.naming.vpc, {
      vpcName: CONFIG.naming.vpc,
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

    this.configureVpcResources(vpc);
    return vpc;
  }

  private configureVpcResources(vpc: ec2.Vpc): void {
    const igw = vpc.node.findChild('IGW') as ec2.CfnInternetGateway;
    igw.overrideLogicalId(CONFIG.naming.igw);

    vpc.publicSubnets.forEach((subnet, index) => {
      const cfnSubnet = subnet.node.defaultChild as ec2.CfnSubnet;
      cfnSubnet.overrideLogicalId(CONFIG.naming.getSubnetId(index));
      
      const routeTable = subnet.node.findChild('RouteTable') as ec2.CfnRouteTable;
      routeTable.overrideLogicalId(CONFIG.naming.getRouteTableId(index));
    });
  }

  private createSecurityGroups() {
    const albSg = new ec2.SecurityGroup(this, `${LOGICAL_PREFIX}AlbSg`, {
      vpc: this.vpc,
      securityGroupName: `${LOGICAL_PREFIX}AlbSg`,
      description: 'Security group for ALB',
      allowAllOutbound: true,
    });

    albSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP'
    );

    const appSg = new ec2.SecurityGroup(this, `${LOGICAL_PREFIX}AppSg`, {
      vpc: this.vpc,
      securityGroupName: `${LOGICAL_PREFIX}AppSg`,
      description: 'Security group for App',
      allowAllOutbound: true,
    });

    this.configureAppSecurityGroupRules(appSg, albSg);

    return { albSg, appSg };
  }

  private configureAppSecurityGroupRules(appSg: ec2.SecurityGroup, albSg: ec2.SecurityGroup): void {
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
      instanceName: CONFIG.naming.ec2,
      blockDevices: [{
        deviceName: '/dev/xvda',
        volume: ec2.BlockDeviceVolume.ebs(CONFIG.app.volumeSize),
      }],
    });
  }

  private createLoadBalancer(): elbv2.ApplicationLoadBalancer {
    return new elbv2.ApplicationLoadBalancer(this, 'AppLoadBalancer', {
      vpc: this.vpc,
      internetFacing: true,
      loadBalancerName: CONFIG.naming.alb,
      securityGroup: this.albSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC }
    });
  }

  private configureLoadBalancer(): void {
    const targetGroup = this.createTargetGroup();
    this.alb.addListener('HttpListener', {
      port: 80,
      defaultTargetGroups: [targetGroup],
    });
  }

  private createTargetGroup(): elbv2.ApplicationTargetGroup {
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'AppTargetGroup', {
      vpc: this.vpc,
      port: CONFIG.app.port,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.INSTANCE,
      targetGroupName: `${LOGICAL_PREFIX}Tg`,
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
    const webAclStack = new cdk.Stack(this.app, `${CONFIG.prefix}-WebAclStack`, {
      env: { region: 'us-east-1' },
      crossRegionReferences: true,
    });

    return new wafv2.CfnWebACL(webAclStack, `${CONFIG.prefix}-CloudFrontWebAcl`, {
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
    const oac = this.createOriginAccessControl();
    const distribution = this.createDistribution(webAcl, oac);
    this.configureBucketPolicy(distribution);
    this.configureOriginAccess(distribution, oac);
    return distribution;
  }

  private createOriginAccessControl(): cloudfront.CfnOriginAccessControl {
    return new cloudfront.CfnOriginAccessControl(this, 'CloudFrontOAC', {
      originAccessControlConfig: {
        name: `${LOGICAL_PREFIX}Oac`,
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4'
      }
    });
  }

  private createDistribution(webAcl: wafv2.CfnWebACL, oac: cloudfront.CfnOriginAccessControl): cloudfront.Distribution {
    const cachePolicy = new cloudfront.CachePolicy(this, 'CachingOptimized', {
      cachePolicyName: `${LOGICAL_PREFIX}CachePolicy`,
      comment: 'Caching optimized for S3 static content',
      defaultTtl: CONFIG.cloudfront.cacheDuration.default,
      maxTtl: CONFIG.cloudfront.cacheDuration.max,
      minTtl: CONFIG.cloudfront.cacheDuration.min,
      enableAcceptEncodingBrotli: true,
      enableAcceptEncodingGzip: true,
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
    });

    const distribution = new cloudfront.Distribution(this, CONFIG.naming.cloudfront, {
      defaultBehavior: {
        origin: new origins.S3Origin(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
        compress: true,
        cachePolicy,
        originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
      },
      webAclId: webAcl.attrArn,
      comment: CONFIG.cloudfront.comment,
      defaultRootObject: 'index.html',
      enableIpv6: true,
      httpVersion: cloudfront.HttpVersion.HTTP2,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
    });

    const cfnDistribution = distribution.node.defaultChild as cloudfront.CfnDistribution;
    cfnDistribution.overrideLogicalId(CONFIG.naming.cloudfront);

    return distribution;
  }

  private configureBucketPolicy(distribution: cloudfront.Distribution): void {
    const bucketPolicyStatement = new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      effect: iam.Effect.ALLOW,
      principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
      resources: [`${this.bucket.bucketArn}/*`],
      conditions: {
        StringEquals: {
          'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`
        }
      }
    });
    this.bucket.addToResourcePolicy(bucketPolicyStatement);
  }

  private configureOriginAccess(distribution: cloudfront.Distribution, oac: cloudfront.CfnOriginAccessControl): void {
    const cfnDistribution = distribution.node.defaultChild as cloudfront.CfnDistribution;
    cfnDistribution.addPropertyOverride('DistributionConfig.Origins.0.S3OriginConfig.OriginAccessIdentity', '');
    cfnDistribution.addPropertyOverride('DistributionConfig.Origins.0.OriginAccessControlId', oac.ref);
  }

  private addOutputs(): void {
    // Resource IDs
    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      description: 'VPC ID',
      exportName: `${CONFIG.prefix}-vpc-id`,
    });

    new cdk.CfnOutput(this, 'Ec2InstanceId', {
      value: this.instance.instanceId,
      description: 'EC2 Instance ID',
      exportName: `${CONFIG.prefix}-ec2-instance-id`,
    });

    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront Distribution ID',
      exportName: `${CONFIG.prefix}-cloudfront-distribution-id`,
    });

    // Endpoints
    new cdk.CfnOutput(this, 'Ec2PublicIp', {
      value: this.instance.instancePublicIp,
      description: 'EC2 Instance Public IP',
      exportName: `${CONFIG.prefix}-ec2-public-ip`,
    });

    new cdk.CfnOutput(this, 'AlbEndpoint', {
      value: `http://${this.alb.loadBalancerDnsName}`,
      description: 'Application Load Balancer Endpoint',
      exportName: `${CONFIG.prefix}-alb-endpoint`,
    });

    new cdk.CfnOutput(this, 'CloudFrontEndpoint', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront Distribution Endpoint',
      exportName: `${CONFIG.prefix}-cloudfront-endpoint`,
    });

    // Resource Names
    new cdk.CfnOutput(this, 'S3BucketName', {
      value: this.bucket.bucketName,
      description: 'S3 Bucket Name',
      exportName: `${CONFIG.prefix}-s3-bucket-name`,
    });

    new cdk.CfnOutput(this, 'ResourceNames', {
      value: [
        `VPC: ${CONFIG.prefix}-vpc`,
        `IGW: ${CONFIG.prefix}-igw`,
        `Subnet: ${CONFIG.prefix}-public-subnet-1a`,
        `Route Table: ${CONFIG.prefix}-public-rt-1a`,
        `EC2: ${CONFIG.prefix}-ec2`,
        `ALB: ${CONFIG.prefix}-alb`,
        `S3: ${CONFIG.prefix}-s3`,
        `CloudFront: ${CONFIG.prefix}-cf`
      ].join('\n'),
      description: 'Physical resource names used in this stack',
      exportName: `${CONFIG.prefix}-resource-names`,
    });

    // Environment Variables
    new cdk.CfnOutput(this, 'EnvVarS3Bucket', {
      value: `STORAGE_S3_BUCKET=${this.bucket.bucketName}`,
      description: 'Environment variable for S3 bucket name',
      exportName: `${CONFIG.prefix}-env-s3-bucket`,
    });

    new cdk.CfnOutput(this, 'EnvVarCdnUrl', {
      value: `STORAGE_CDN_URL=https://${this.distribution.distributionDomainName}`,
      description: 'Environment variable for CloudFront URL',
      exportName: `${CONFIG.prefix}-env-cdn-url`,
    });

    new cdk.CfnOutput(this, 'EnvVarCdnDistributionId', {
      value: `STORAGE_CDN_DISTRIBUTION_ID=${this.distribution.distributionId}`,
      description: 'Environment variable for CloudFront Distribution ID',
      exportName: `${CONFIG.prefix}-env-cdn-distribution-id`,
    });
  }
}