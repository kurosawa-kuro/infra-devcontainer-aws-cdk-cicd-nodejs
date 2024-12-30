/**
 * AWS CDK Stack for deploying a containerized web application using Fargate
 * This stack creates the following resources:
 * - VPC with public subnets
 * - ECS Fargate cluster and service
 * - Application Load Balancer
 * - ECR repository
 * - S3 bucket for static content
 * - CloudFront distribution
 * - WAF for CloudFront
 */

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';

// #region Configuration Types
const ECR_REPOSITORY = '476114153361.dkr.ecr.ap-northeast-1.amazonaws.com/aws-fargate-express-01-repository';

namespace Config {
  export interface Stack {
    prefix: string;
    region: string;
    accountId: string;
    resourceNames: ResourceNames;
    vpc: VpcConfig;
    app: AppConfig;
    healthCheck: HealthCheckConfig;
    cloudfront: CloudFrontConfig;
    ecs: EcsConfig;
  }

  export interface ResourceNames {
    vpc: string;
    igw: string;
    getSubnetId: (index: number) => string;
    getRouteTableId: (index: number) => string;
    ecr: string;
    ecsCluster: string;
    ecsService: string;
    ecsTaskDefinition: string;
    alb: string;
    s3: string;
    cloudfront: string;
  }

  export interface VpcConfig {
    cidr: string;
    maxAzs: number;
    subnetMask: number;
  }

  export interface AppConfig {
    port: number;
    healthCheckPath: string;
    containerName: string;
    imageTag: string;
    envVariables: { [key: string]: string };
  }

  export interface EcsConfig {
    taskCount: number;
    cpu: number;
    memory: number;
    logRetentionDays: number;
  }

  export interface HealthCheckConfig {
    healthyThreshold: number;
    unhealthyThreshold: number;
    timeout: number;
    interval: number;
  }

  export interface CloudFrontConfig {
    comment: string;
    cacheDuration: {
      default: cdk.Duration;
      max: cdk.Duration;
      min: cdk.Duration;
    };
  }
}
// #endregion

// #region Stack Configuration
const LOGICAL_PREFIX = 'fargateexpress02';
const CONFIG: Config.Stack = {
  prefix: LOGICAL_PREFIX,
  region: 'ap-northeast-1',
  accountId: '476114153361',
  resourceNames: {
    vpc: `${LOGICAL_PREFIX}vpc`,
    igw: `${LOGICAL_PREFIX}igw`,
    getSubnetId: (index: number) => `${LOGICAL_PREFIX}subnet${index === 0 ? '1a' : '1c'}`,
    getRouteTableId: (index: number) => `${LOGICAL_PREFIX}rt${index === 0 ? '1a' : '1c'}`,
    ecr: `${LOGICAL_PREFIX}repository`,
    ecsCluster: `${LOGICAL_PREFIX}cluster`,
    ecsService: `${LOGICAL_PREFIX}service`,
    ecsTaskDefinition: `${LOGICAL_PREFIX}task`,
    alb: `${LOGICAL_PREFIX}alb`,
    s3: `${LOGICAL_PREFIX}s3`,
    cloudfront: `${LOGICAL_PREFIX}cf`,
  },
  vpc: {
    cidr: '10.5.0.0/16',
    maxAzs: 2,
    subnetMask: 24,
  },
  app: {
    port: 8080,
    healthCheckPath: '/health',
    containerName: 'FargateExpress01',
    imageTag: 'latest',
    envVariables: {
      APP_ENV: 'production'
    }
  },
  ecs: {
    taskCount: 1,
    cpu: 256,
    memory: 512,
    logRetentionDays: 30
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
// #endregion

// #region Stack Resources Interface
interface StackResources {
  vpc: ec2.Vpc;
  securityGroups: {
    alb: ec2.SecurityGroup;
    app: ec2.SecurityGroup;
  };
  cluster: ecs.Cluster;
  taskDefinition: ecs.FargateTaskDefinition;
  service: ecs.FargateService;
  alb: elbv2.ApplicationLoadBalancer;
  bucket: s3.Bucket;
  distribution: cloudfront.Distribution;
}
// #endregion

export class AwsCdkWebFargateStack extends cdk.Stack {
  private readonly app: cdk.App;
  private readonly resources: StackResources;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      ...props,
      env: { region: CONFIG.region },
      crossRegionReferences: true,
    });

    this.app = scope as cdk.App;
    this.resources = this.createInfrastructure();
    this.addStackOutputs();
  }

  // #region Infrastructure Creation
  private createInfrastructure(): StackResources {
    // Network Infrastructure
    const vpc = this.createVpcInfrastructure();
    const securityGroups = this.createSecurityGroups(vpc);

    // Container Infrastructure
    const cluster = this.createEcsCluster(vpc);
    const taskDefinition = this.createTaskDefinition();
    
    // Load Balancer
    const alb = this.createLoadBalancer(vpc, securityGroups.alb);
    
    // ECS Service
    const service = this.createEcsService(cluster, taskDefinition, vpc, securityGroups.app, alb);

    // Content Delivery Infrastructure
    const bucket = this.createStorageBucket();
    const webAcl = this.createWebAcl();
    const distribution = this.createContentDeliveryNetwork(bucket, webAcl);

    return {
      vpc,
      securityGroups,
      cluster,
      taskDefinition,
      service,
      alb,
      bucket,
      distribution,
    };
  }
  // #endregion

  // #region Network Infrastructure
  private createVpcInfrastructure(): ec2.Vpc {
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
    const cfnVpc = vpc.node.defaultChild as ec2.CfnVPC;
    cfnVpc?.overrideLogicalId(CONFIG.resourceNames.vpc);

    const igw = this.createInternetGateway();
    const vpcGatewayAttachment = this.attachInternetGateway(vpc, igw);

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
    // ALBのセキュリティグループ
    const albSg = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc,
      securityGroupName: `${CONFIG.prefix}albsg`,
      description: 'Security group for ALB',
      allowAllOutbound: true,
    });

    // インターネットからALBへの80ポートアクセスを許可
    albSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP from anywhere'
    );

    // アプリケーションのセキュリティグループ
    const appSg = new ec2.SecurityGroup(this, 'AppSecurityGroup', {
      vpc,
      securityGroupName: `${CONFIG.prefix}appsg`,
      description: 'Security group for Fargate tasks',
      allowAllOutbound: true,
    });

    // ALBからアプリケーションへの8080ポートアクセスを許可
    appSg.addIngressRule(
      ec2.Peer.securityGroupId(albSg.securityGroupId),
      ec2.Port.tcp(CONFIG.app.port),  // 8080
      'Allow ingress from ALB'
    );

    return { alb: albSg, app: appSg };
  }
  // #endregion

  // #region Container Infrastructure
  private createEcsCluster(vpc: ec2.Vpc): ecs.Cluster {
    return new ecs.Cluster(this, 'AppCluster', {
      vpc,
      clusterName: CONFIG.resourceNames.ecsCluster,
      containerInsights: true,
    });
  }

  private createTaskDefinition(): ecs.FargateTaskDefinition {
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'AppTaskDefinition', {
      family: CONFIG.resourceNames.ecsTaskDefinition,
      cpu: CONFIG.ecs.cpu,
      memoryLimitMiB: CONFIG.ecs.memory,
    });

    // Add ECR permissions to task execution role
    taskDefinition.addToExecutionRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'ecr:GetAuthorizationToken',
          'ecr:BatchCheckLayerAvailability',
          'ecr:GetDownloadUrlForLayer',
          'ecr:BatchGetImage'
        ],
        resources: ['*']
      })
    );

    // Add Parameter Store permissions to task execution role
    taskDefinition.addToExecutionRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'ssm:GetParameters',
          'ssm:GetParameter'
        ],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/fargateexpress02/prod/*`
        ]
      })
    );

    const logGroup = new logs.LogGroup(this, 'AppLogGroup', {
      logGroupName: `/ecs/${CONFIG.resourceNames.ecsTaskDefinition}`,
      retention: CONFIG.ecs.logRetentionDays,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    taskDefinition.addContainer('AppContainer', {
      containerName: CONFIG.app.containerName,
      image: ecs.ContainerImage.fromRegistry(ECR_REPOSITORY),
      portMappings: [{ containerPort: CONFIG.app.port }],
      environment: {
        APP_ENV: 'production'
      },
      secrets: {
        DATABASE_URL: ecs.Secret.fromSsmParameter(
          ssm.StringParameter.fromSecureStringParameterAttributes(this, 'DatabaseUrlParam', {
            parameterName: '/fargateexpress02/prod/database-url',
            version: 1
          })
        )
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'ecs',
        logGroup,
      }),
    });

    return taskDefinition;
  }

  private createEcsService(
    cluster: ecs.Cluster,
    taskDefinition: ecs.FargateTaskDefinition,
    vpc: ec2.Vpc,
    securityGroup: ec2.SecurityGroup,
    alb: elbv2.ApplicationLoadBalancer
  ): ecs.FargateService {
    const targetGroup = this.createTargetGroup(vpc);
    this.configureAlbListener(alb, targetGroup);

    const service = new ecs.FargateService(this, 'AppService', {
      cluster,
      serviceName: CONFIG.resourceNames.ecsService,
      taskDefinition,
      desiredCount: CONFIG.ecs.taskCount,
      securityGroups: [securityGroup],
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    service.attachToApplicationTargetGroup(targetGroup);

    return service;
  }

  private createTargetGroup(vpc: ec2.Vpc): elbv2.ApplicationTargetGroup {
    return new elbv2.ApplicationTargetGroup(this, 'AppTargetGroup', {
      vpc,
      port: CONFIG.app.port,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      targetGroupName: `${CONFIG.prefix}tg`,
      healthCheck: {
        path: CONFIG.app.healthCheckPath,
        port: CONFIG.app.port.toString(),
        healthyThresholdCount: CONFIG.healthCheck.healthyThreshold,
        unhealthyThresholdCount: CONFIG.healthCheck.unhealthyThreshold,
        timeout: cdk.Duration.seconds(CONFIG.healthCheck.timeout),
        interval: cdk.Duration.seconds(CONFIG.healthCheck.interval),
      }
    });
  }

  private configureAlbListener(
    alb: elbv2.ApplicationLoadBalancer,
    targetGroup: elbv2.ApplicationTargetGroup
  ): void {
    alb.addListener('HttpListener', {
      port: 80,
      defaultTargetGroups: [targetGroup],
    });
  }
  // #endregion

  // #region Content Delivery Infrastructure
  private createStorageBucket(): s3.Bucket {
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

  private createContentDeliveryNetwork(
    bucket: s3.Bucket,
    webAcl: wafv2.CfnWebACL
  ): cloudfront.Distribution {
    const oac = this.createOriginAccessControl();
    const cachePolicy = this.createCachePolicy();
    const distribution = this.createDistribution(bucket, webAcl, cachePolicy);
    
    this.configureBucketPolicy(bucket, distribution);
    this.configureOriginAccess(distribution, oac);
    
    return distribution;
  }

  private createOriginAccessControl(): cloudfront.CfnOriginAccessControl {
    return new cloudfront.CfnOriginAccessControl(this, 'CloudFrontOAC', {
      originAccessControlConfig: {
        name: `${CONFIG.prefix}-oac`,
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4'
      }
    });
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
    webAcl: wafv2.CfnWebACL,
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
      },
      webAclId: webAcl.attrArn,
      comment: CONFIG.cloudfront.comment,
      defaultRootObject: 'index.html',
      enableIpv6: true,
      httpVersion: cloudfront.HttpVersion.HTTP2,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
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
  // #endregion

  // #region Stack Outputs
  private addStackOutputs(): void {
    this.addResourceIdOutputs();
    this.addEndpointOutputs();
    this.addResourceNameOutputs();
    this.addEnvironmentVariableOutputs();
  }

  private addResourceIdOutputs(): void {
    new cdk.CfnOutput(this, 'VpcId', {
      value: this.resources.vpc.vpcId,
      description: 'VPC ID',
      exportName: `${CONFIG.prefix}-vpc-id`,
    });

    new cdk.CfnOutput(this, 'EcsClusterArn', {
      value: this.resources.cluster.clusterArn,
      description: 'ECS Cluster ARN',
      exportName: `${CONFIG.prefix}-ecs-cluster-arn`,
    });

    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: this.resources.distribution.distributionId,
      description: 'CloudFront Distribution ID',
      exportName: `${CONFIG.prefix}-cloudfront-distribution-id`,
    });
  }

  private addEndpointOutputs(): void {
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
        `ECS Cluster: ${CONFIG.resourceNames.ecsCluster}`,
        `ECS Service: ${CONFIG.resourceNames.ecsService}`,
        `Task Definition: ${CONFIG.resourceNames.ecsTaskDefinition}`,
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
  // #endregion

  private createLoadBalancer(vpc: ec2.Vpc, securityGroup: ec2.SecurityGroup): elbv2.ApplicationLoadBalancer {
    return new elbv2.ApplicationLoadBalancer(this, 'AppLoadBalancer', {
      vpc,
      internetFacing: true,
      loadBalancerName: CONFIG.resourceNames.alb,
      securityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC }
    });
  }
}