import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';

// Configuration types
interface StackConfig {
  prefix: string;
  region: string;
  resourceNames: ResourceNames;
  vpc: VpcConfig;
  app: AppConfig;
  healthCheck: HealthCheckConfig;
  cloudfront: CloudFrontConfig;
}

interface ResourceNames {
  vpc: string;
  igw: string;
  getSubnetId: (index: number) => string;
  getRouteTableId: (index: number) => string;
  ec2: string;
  alb: string;
  s3: string;
  cloudfront: string;
}

interface VpcConfig {
  cidr: string;
  maxAzs: number;
  subnetMask: number;
}

interface AppConfig {
  port: number;
  healthCheckPath: string;
  ami: string;
  instanceType: ec2.InstanceType;
  keyName: string;
  volumeSize: number;
}

interface HealthCheckConfig {
  healthyThreshold: number;
  unhealthyThreshold: number;
  timeout: number;
  interval: number;
}

interface CloudFrontConfig {
  comment: string;
  cacheDuration: {
    default: cdk.Duration;
    max: cdk.Duration;
    min: cdk.Duration;
  };
}

// Stack configuration
const LOGICAL_PREFIX = 'CdkJavascript01';
const CONFIG: StackConfig = {
  prefix: LOGICAL_PREFIX.toLowerCase(),
  region: 'ap-northeast-1',
  resourceNames: {
    vpc: `${LOGICAL_PREFIX}Vpc`,
    igw: `${LOGICAL_PREFIX}Igw`,
    getSubnetId: (index: number) => `${LOGICAL_PREFIX}PublicSubnet${index === 0 ? '1a' : '1c'}`,
    getRouteTableId: (index: number) => `${LOGICAL_PREFIX}PublicRt${index === 0 ? '1a' : '1c'}`,
    ec2: `${LOGICAL_PREFIX}Ec2`,
    alb: `${LOGICAL_PREFIX}Alb`,
    s3: `${LOGICAL_PREFIX}S3`,
    cloudfront: `${LOGICAL_PREFIX}Cf`
  },
  vpc: {
    cidr: '10.1.0.0/16',
    maxAzs: 2,
    subnetMask: 24,
  },
  app: {
    port: 8080,
    healthCheckPath: '/health',
    ami: 'ami-0391106ef30c99847',
    instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO),
    keyName: 'training',
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
};

export class AwsCdkWebBasicStack extends cdk.Stack {
  private readonly app: cdk.App;
  private readonly resources: {
    vpc: ec2.Vpc;
    securityGroups: {
      alb: ec2.SecurityGroup;
      app: ec2.SecurityGroup;
    };
    instance: ec2.Instance;
    alb: elbv2.ApplicationLoadBalancer;
    bucket: s3.Bucket;
    distribution: cloudfront.Distribution;
  };

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      ...props,
      env: { region: CONFIG.region },
      crossRegionReferences: true,
    });

    this.app = scope as cdk.App;
    this.resources = this.createResources();
    this.addOutputs();
  }

  private createResources() {
    // Network Infrastructure
    const vpc = this.createVpc();
    const securityGroups = this.createSecurityGroups(vpc);

    // Compute Resources
    const instance = this.createEc2Instance(vpc, securityGroups.app);
    const alb = this.createLoadBalancer(vpc, securityGroups.alb);
    this.configureLoadBalancer(alb, vpc, instance);

    // Storage and CDN
    const bucket = this.createS3Bucket();
    const distribution = this.createCloudFrontDistribution(bucket);

    return {
      vpc,
      securityGroups,
      instance,
      alb,
      bucket,
      distribution,
    };
  }

  private createVpc(): ec2.Vpc {
    const vpc = new ec2.Vpc(this, CONFIG.resourceNames.vpc, {
      vpcName: CONFIG.resourceNames.vpc,
      ipAddresses: ec2.IpAddresses.cidr(CONFIG.vpc.cidr),
      maxAzs: CONFIG.vpc.maxAzs,
      natGateways: 0,
      subnetConfiguration: [{
        name: `${CONFIG.resourceNames.vpc}Public`,
        subnetType: ec2.SubnetType.PUBLIC,
        mapPublicIpOnLaunch: true,
        cidrMask: CONFIG.vpc.subnetMask
      }],
      createInternetGateway: false
    });

    this.configureVpcComponents(vpc);
    return vpc;
  }

  private configureVpcComponents(vpc: ec2.Vpc): void {
    // Set VPC logical ID
    const cfnVpc = vpc.node.defaultChild as ec2.CfnVPC;
    cfnVpc?.overrideLogicalId(CONFIG.resourceNames.vpc);

    // Create and attach IGW
    const igw = this.createInternetGateway();
    const vpcGatewayAttachment = this.attachInternetGateway(vpc, igw);

    // Configure subnets and routing
    vpc.publicSubnets.forEach((subnet, index) => {
      this.configurePublicSubnet(subnet, index, igw, vpcGatewayAttachment);
    });
  }

  private createInternetGateway(): ec2.CfnInternetGateway {
    const igw = new ec2.CfnInternetGateway(this, 'IGW', {
      tags: [{ key: 'Name', value: CONFIG.resourceNames.igw }]
    });
    igw.overrideLogicalId(CONFIG.resourceNames.igw);
    return igw;
  }

  private attachInternetGateway(vpc: ec2.Vpc, igw: ec2.CfnInternetGateway): ec2.CfnVPCGatewayAttachment {
    const attachment = new ec2.CfnVPCGatewayAttachment(this, 'VPCGW', {
      vpcId: vpc.vpcId,
      internetGatewayId: igw.ref
    });
    attachment.overrideLogicalId(`${CONFIG.resourceNames.vpc}GatewayAttachment`);
    return attachment;
  }

  private configurePublicSubnet(
    subnet: ec2.IPublicSubnet,
    index: number,
    igw: ec2.CfnInternetGateway,
    vpcGatewayAttachment: ec2.CfnVPCGatewayAttachment
  ): void {
    const cfnSubnet = subnet.node.defaultChild as ec2.CfnSubnet;
    const subnetLogicalId = CONFIG.resourceNames.getSubnetId(index);
    
    cfnSubnet.overrideLogicalId(subnetLogicalId);
    cfnSubnet.addPropertyOverride('Tags', [
      { Key: 'Name', Value: subnetLogicalId },
      { Key: 'aws-cdk:subnet-name', Value: `${CONFIG.resourceNames.vpc}Public` },
      { Key: 'aws-cdk:subnet-type', Value: 'Public' }
    ]);

    this.configureRouteTable(subnet, index, igw, vpcGatewayAttachment);
  }

  private configureRouteTable(
    subnet: ec2.IPublicSubnet,
    index: number,
    igw: ec2.CfnInternetGateway,
    vpcGatewayAttachment: ec2.CfnVPCGatewayAttachment
  ): void {
    const routeTable = subnet.node.findChild('RouteTable') as ec2.CfnRouteTable;
    const routeTableId = CONFIG.resourceNames.getRouteTableId(index);
    
    routeTable.overrideLogicalId(routeTableId);
    routeTable.addPropertyOverride('Tags', [
      { Key: 'Name', Value: routeTableId }
    ]);

    const publicRoute = new ec2.CfnRoute(this, `PublicRoute${index}`, {
      routeTableId: routeTable.ref,
      destinationCidrBlock: '0.0.0.0/0',
      gatewayId: igw.ref,
    });
    publicRoute.overrideLogicalId(`${CONFIG.resourceNames.vpc}PublicRoute${index === 0 ? '1a' : '1c'}`);
    publicRoute.addDependency(vpcGatewayAttachment);
  }

  private createSecurityGroups(vpc: ec2.Vpc) {
    const albSg = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc,
      securityGroupName: `${CONFIG.prefix}-alb-sg`,
      description: 'Security group for ALB',
      allowAllOutbound: true,
    });

    cdk.Tags.of(albSg).add('Name', `${CONFIG.prefix}-alb-sg`);

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

    cdk.Tags.of(appSg).add('Name', `${CONFIG.prefix}-app-sg`);

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

    return { alb: albSg, app: appSg };
  }

  private createEc2Instance(vpc: ec2.Vpc, securityGroup: ec2.SecurityGroup): ec2.Instance {
    return new ec2.Instance(this, 'AppInstance', {
      vpc,
      instanceType: CONFIG.app.instanceType,
      machineImage: ec2.MachineImage.genericLinux({
        [CONFIG.region]: CONFIG.app.ami,
      }),
      securityGroup,
      keyPair: ec2.KeyPair.fromKeyPairName(this, 'KeyPair', CONFIG.app.keyName),
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceName: CONFIG.resourceNames.ec2,
      blockDevices: [{
        deviceName: '/dev/xvda',
        volume: ec2.BlockDeviceVolume.ebs(CONFIG.app.volumeSize),
      }],
    });
  }

  private createLoadBalancer(vpc: ec2.Vpc, securityGroup: ec2.SecurityGroup): elbv2.ApplicationLoadBalancer {
    return new elbv2.ApplicationLoadBalancer(this, 'AppLoadBalancer', {
      vpc,
      internetFacing: true,
      loadBalancerName: CONFIG.resourceNames.alb,
      securityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC }
    });
  }

  private configureLoadBalancer(
    alb: elbv2.ApplicationLoadBalancer,
    vpc: ec2.Vpc,
    instance: ec2.Instance
  ): void {
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'AppTargetGroup', {
      vpc,
      port: CONFIG.app.port,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.INSTANCE,
      targetGroupName: `${CONFIG.prefix}-tg`,
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

  private createCloudFrontDistribution(
    bucket: s3.Bucket,
  ): cloudfront.Distribution {
    const oac = new cloudfront.CfnOriginAccessControl(this, 'CloudFrontOAC', {
      originAccessControlConfig: {
        name: `${CONFIG.prefix}-oac`,
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4'
      }
    });

    const cachePolicy = this.createCachePolicy();
    const distribution = this.createDistribution(bucket, cachePolicy);
    
    this.configureBucketPolicy(bucket, distribution);
    this.configureOriginAccess(distribution, oac);
    
    return distribution;
  }

  private createCachePolicy(): cloudfront.CachePolicy {
    return new cloudfront.CachePolicy(this, 'CachingOptimized', {
      cachePolicyName: `${CONFIG.prefix}-cache-policy`,
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
  }

  private createDistribution(
    bucket: s3.Bucket,
    cachePolicy: cloudfront.CachePolicy
  ): cloudfront.Distribution {
    const distribution = new cloudfront.Distribution(this, 'StaticContentDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
        compress: true,
        cachePolicy,
        originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
        responseHeadersPolicy: new cloudfront.ResponseHeadersPolicy(this, 'CountryHeadersPolicy', {
          customHeadersBehavior: {
            customHeaders: [
              {
                header: 'CloudFront-Viewer-Country',
                value: '${CloudFront-Viewer-Country}',
                override: true
              },
              {
                header: 'CloudFront-Viewer-Country-Name',
                value: '${CloudFront-Viewer-Country-Name}',
                override: true
              },
              {
                header: 'CloudFront-Viewer-Country-Region',
                value: '${CloudFront-Viewer-Country-Region}',
                override: true
              }
            ]
          }
        })
      },
      comment: CONFIG.cloudfront.comment,
      defaultRootObject: 'index.html',
      enableIpv6: true,
      httpVersion: cloudfront.HttpVersion.HTTP2,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      geoRestriction: cloudfront.GeoRestriction.allowlist(
        'JP',  // 日本
        'US',  // アメリカ
        'GB',  // イギリス
        'CN',  // 中国
        'KR',  // 韓国
        'TW'   // 台湾
      )
    });

    const cfnDistribution = distribution.node.defaultChild as cloudfront.CfnDistribution;
    cfnDistribution.overrideLogicalId(CONFIG.resourceNames.cloudfront);

    return distribution;
  }

  private configureBucketPolicy(bucket: s3.Bucket, distribution: cloudfront.Distribution): void {
    const bucketPolicyStatement = new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      effect: iam.Effect.ALLOW,
      principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
      resources: [`${bucket.bucketArn}/*`],
      conditions: {
        StringEquals: {
          'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`
        }
      }
    });
    bucket.addToResourcePolicy(bucketPolicyStatement);
  }

  private configureOriginAccess(
    distribution: cloudfront.Distribution,
    oac: cloudfront.CfnOriginAccessControl
  ): void {
    const cfnDistribution = distribution.node.defaultChild as cloudfront.CfnDistribution;
    cfnDistribution.addPropertyOverride('DistributionConfig.Origins.0.S3OriginConfig.OriginAccessIdentity', '');
    cfnDistribution.addPropertyOverride('DistributionConfig.Origins.0.OriginAccessControlId', oac.ref);
  }

  private addOutputs(): void {
    this.addResourceIdOutputs();
    this.addEndpointOutputs();
    this.addResourceNameOutputs();
    this.addEnvironmentVariableOutputs();
    this.addNotificationCommandOutput();
  }

  private addResourceIdOutputs(): void {
    new cdk.CfnOutput(this, 'VpcId', {
      value: this.resources.vpc.vpcId,
      description: 'VPC ID',
      exportName: `${CONFIG.prefix}-vpc-id`,
    });

    new cdk.CfnOutput(this, 'Ec2InstanceId', {
      value: this.resources.instance.instanceId,
      description: 'EC2 Instance ID',
      exportName: `${CONFIG.prefix}-ec2-instance-id`,
    });

    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: this.resources.distribution.distributionId,
      description: 'CloudFront Distribution ID',
      exportName: `${CONFIG.prefix}-cloudfront-distribution-id`,
    });
  }

  private addEndpointOutputs(): void {
    new cdk.CfnOutput(this, 'Ec2PublicIp', {
      value: this.resources.instance.instancePublicIp,
      description: 'EC2 Instance Public IP',
      exportName: `${CONFIG.prefix}-ec2-public-ip`,
    });

    new cdk.CfnOutput(this, 'AlbEndpoint', {
      value: this.resources.alb.loadBalancerDnsName,
      description: 'Application Load Balancer Endpoint',
      exportName: `${CONFIG.prefix}-alb-endpoint`,
    });

    new cdk.CfnOutput(this, 'CloudFrontEndpoint', {
      value: this.resources.distribution.distributionDomainName,
      description: 'CloudFront Distribution Endpoint',
      exportName: `${CONFIG.prefix}-cloudfront-endpoint`,
    });
  }

  private addResourceNameOutputs(): void {
    new cdk.CfnOutput(this, 'S3BucketName', {
      value: this.resources.bucket.bucketName,
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
  }

  private addEnvironmentVariableOutputs(): void {
    new cdk.CfnOutput(this, 'EnvVarS3Bucket', {
      value: `STORAGE_S3_BUCKET=${this.resources.bucket.bucketName}`,
      description: 'Environment variable for S3 bucket name',
      exportName: `${CONFIG.prefix}-env-s3-bucket`,
    });

    new cdk.CfnOutput(this, 'EnvVarCdnUrl', {
      value: `STORAGE_CDN_URL=https://${this.resources.distribution.distributionDomainName}`,
      description: 'Environment variable for CloudFront URL',
      exportName: `${CONFIG.prefix}-env-cdn-url`,
    });

    new cdk.CfnOutput(this, 'EnvVarCdnDistributionId', {
      value: `STORAGE_CDN_DISTRIBUTION_ID=${this.resources.distribution.distributionId}`,
      description: 'Environment variable for CloudFront Distribution ID',
      exportName: `${CONFIG.prefix}-env-cdn-distribution-id`,
    });
  }

  private addNotificationCommandOutput(): void {
    new cdk.CfnOutput(this, 'NotificationCommand', {
      value: 'aws lambda invoke --function-name arn:aws:lambda:ap-northeast-1:448049833348:function:slack-notification --payload \'{}\' response.json',
      description: 'Command to invoke Slack notification Lambda',
    });
  }
}