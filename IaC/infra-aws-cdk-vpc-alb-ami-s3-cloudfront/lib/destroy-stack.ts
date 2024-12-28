import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as cr from 'aws-cdk-lib/custom-resources';

const PREFIX = 'cdk-express-01';

export class DestroyStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Step 1: Remove CloudFront Distribution and related resources
    const distribution = new cloudfront.CfnDistribution(this, 'DeleteCloudFront', {
      distributionConfig: {
        enabled: false,
        defaultCacheBehavior: {
          targetOriginId: 'dummy',
          viewerProtocolPolicy: 'redirect-to-https',
          forwardedValues: {
            queryString: false,
            cookies: { forward: 'none' }
          }
        },
        origins: [{
          id: 'dummy',
          domainName: 'dummy.s3.amazonaws.com',
          s3OriginConfig: { originAccessIdentity: '' }
        }]
      }
    });
    distribution.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // Remove CloudFront Cache Policy
    const cachePolicy = new cloudfront.CfnCachePolicy(this, 'DeleteCachePolicy', {
      cachePolicyConfig: {
        name: `${PREFIX}-cache-policy`,
        defaultTtl: cdk.Duration.days(1).toSeconds(),
        minTtl: cdk.Duration.seconds(1).toSeconds(),
        maxTtl: cdk.Duration.days(365).toSeconds(),
        parametersInCacheKeyAndForwardedToOrigin: {
          enableAcceptEncodingGzip: true,
          enableAcceptEncodingBrotli: true,
          cookiesConfig: { cookieBehavior: 'none' },
          headersConfig: { headerBehavior: 'none' },
          queryStringsConfig: { queryStringBehavior: 'none' }
        }
      }
    });
    cachePolicy.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // Remove CloudFront OAC
    const oac = new cloudfront.CfnOriginAccessControl(this, 'DeleteOAC', {
      originAccessControlConfig: {
        name: `${PREFIX}-oac`,
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4'
      }
    });
    oac.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // Step 2: Remove WAF WebACL
    const webAclStack = new cdk.Stack(this, `${PREFIX}-WebAclStack`, {
      env: { region: 'us-east-1' },
      crossRegionReferences: true,
    });

    new cdk.CfnResource(webAclStack, 'DeleteWebAcl', {
      type: 'AWS::WAFv2::WebACL',
      properties: {
        Name: `${PREFIX}-cf-waf`,
        Scope: 'CLOUDFRONT',
        DefaultAction: { Allow: {} },
        VisibilityConfig: {
          SampledRequestsEnabled: true,
          CloudWatchMetricsEnabled: true,
          MetricName: `${PREFIX}-cf-waf-metric`
        },
        Rules: []
      }
    }).applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // Step 3: Remove S3 Bucket
    const bucket = new s3.CfnBucket(this, 'DeleteS3', {
      bucketName: `${PREFIX}-s3`
    });
    bucket.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // Step 4: Remove ALB and related resources
    const alb = new elbv2.CfnLoadBalancer(this, 'DeleteALB', {
      name: `${PREFIX}-alb`,
      type: 'application',
      subnets: [`${PREFIX}-public-subnet-1a`, `${PREFIX}-public-subnet-1c`]
    });
    alb.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // Remove Target Group
    const targetGroup = new elbv2.CfnTargetGroup(this, 'DeleteTargetGroup', {
      name: `${PREFIX}-tg`,
      protocol: 'HTTP',
      port: 80,
      targetType: 'instance',
      vpcId: `${PREFIX}-vpc`
    });
    targetGroup.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // Step 5: Remove Security Groups
    const albSg = new ec2.CfnSecurityGroup(this, 'DeleteAlbSG', {
      groupName: `${PREFIX}-alb-sg`,
      groupDescription: 'Security group for ALB',
      vpcId: `${PREFIX}-vpc`
    });
    albSg.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    const appSg = new ec2.CfnSecurityGroup(this, 'DeleteAppSG', {
      groupName: `${PREFIX}-app-sg`,
      groupDescription: 'Security group for Application',
      vpcId: `${PREFIX}-vpc`
    });
    appSg.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // Step 6: Remove EC2 Instance
    const ec2Instance = new ec2.CfnInstance(this, 'DeleteEC2', {
      instanceType: 't2.micro',
      imageId: 'ami-dummy',
      tags: [{ key: 'Name', value: `${PREFIX}-ec2` }]
    });
    ec2Instance.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // Step 7: Remove VPC and related resources
    // Remove Route Tables
    const rt1a = new ec2.CfnRouteTable(this, 'DeleteRouteTable1a', {
      vpcId: `${PREFIX}-vpc`,
      tags: [{ key: 'Name', value: `${PREFIX}-public-rt-1a` }]
    });
    rt1a.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    const rt1c = new ec2.CfnRouteTable(this, 'DeleteRouteTable1c', {
      vpcId: `${PREFIX}-vpc`,
      tags: [{ key: 'Name', value: `${PREFIX}-public-rt-1c` }]
    });
    rt1c.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // Remove Subnets
    const subnet1a = new ec2.CfnSubnet(this, 'DeleteSubnet1a', {
      vpcId: `${PREFIX}-vpc`,
      cidrBlock: '10.0.1.0/24',
      availabilityZone: 'ap-northeast-1a',
      tags: [{ key: 'Name', value: `${PREFIX}-public-subnet-1a` }]
    });
    subnet1a.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    const subnet1c = new ec2.CfnSubnet(this, 'DeleteSubnet1c', {
      vpcId: `${PREFIX}-vpc`,
      cidrBlock: '10.0.2.0/24',
      availabilityZone: 'ap-northeast-1c',
      tags: [{ key: 'Name', value: `${PREFIX}-public-subnet-1c` }]
    });
    subnet1c.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // Remove Internet Gateway
    const igw = new ec2.CfnInternetGateway(this, 'DeleteIGW', {
      tags: [{ key: 'Name', value: `${PREFIX}-igw` }]
    });
    igw.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // Remove VPC
    const vpc = new ec2.CfnVPC(this, 'DeleteVPC', {
      cidrBlock: '10.0.0.0/16',
      enableDnsHostnames: true,
      enableDnsSupport: true,
      tags: [{ key: 'Name', value: `${PREFIX}-vpc` }]
    });
    vpc.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
  }
}