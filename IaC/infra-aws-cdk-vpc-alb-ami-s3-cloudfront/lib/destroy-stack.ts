import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

const PREFIX = 'cdk-express-01';

interface ResourceConfig {
  prefix: string;
  vpcCidr: string;
  subnet1aCidr: string;
  subnet1cCidr: string;
}

export class DestroyStack extends cdk.Stack {
  private readonly config: ResourceConfig;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.config = {
      prefix: PREFIX,
      vpcCidr: '10.0.0.0/16',
      subnet1aCidr: '10.0.1.0/24',
      subnet1cCidr: '10.0.2.0/24'
    };

    this.destroyCloudFrontResources();
    this.destroyWAFResources();
    this.destroyS3Resources();
    this.destroyLoadBalancerResources();
    this.destroySecurityGroups();
    this.destroyEC2Resources();
    this.destroyNetworkResources();
  }

  private applyDestroyPolicy(resource: cdk.CfnResource) {
    resource.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
  }

  private addNameTag(name: string): cdk.CfnTag[] {
    return [{ key: 'Name', value: `${this.config.prefix}-${name}` }];
  }

  private destroyCloudFrontResources(): void {
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
    this.applyDestroyPolicy(distribution);

    const cachePolicy = new cloudfront.CfnCachePolicy(this, 'DeleteCachePolicy', {
      cachePolicyConfig: {
        name: `${this.config.prefix}-cache-policy`,
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
    this.applyDestroyPolicy(cachePolicy);

    const oac = new cloudfront.CfnOriginAccessControl(this, 'DeleteOAC', {
      originAccessControlConfig: {
        name: `${this.config.prefix}-oac`,
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4'
      }
    });
    this.applyDestroyPolicy(oac);
  }

  private destroyWAFResources(): void {
    const webAclStack = new cdk.Stack(this, `${this.config.prefix}-WebAclStack`, {
      env: { region: 'us-east-1' },
      crossRegionReferences: true,
    });

    const webAcl = new cdk.CfnResource(webAclStack, 'DeleteWebAcl', {
      type: 'AWS::WAFv2::WebACL',
      properties: {
        Name: `${this.config.prefix}-cf-waf`,
        Scope: 'CLOUDFRONT',
        DefaultAction: { Allow: {} },
        VisibilityConfig: {
          SampledRequestsEnabled: true,
          CloudWatchMetricsEnabled: true,
          MetricName: `${this.config.prefix}-cf-waf-metric`
        },
        Rules: []
      }
    });
    this.applyDestroyPolicy(webAcl);
  }

  private destroyS3Resources(): void {
    const bucket = new s3.CfnBucket(this, 'DeleteS3', {
      bucketName: `${this.config.prefix}-s3`
    });
    this.applyDestroyPolicy(bucket);
  }

  private destroyLoadBalancerResources(): void {
    const alb = new elbv2.CfnLoadBalancer(this, 'DeleteALB', {
      name: `${this.config.prefix}-alb`,
      type: 'application',
      subnets: [
        `${this.config.prefix}-public-subnet-1a`,
        `${this.config.prefix}-public-subnet-1c`
      ]
    });
    this.applyDestroyPolicy(alb);

    const targetGroup = new elbv2.CfnTargetGroup(this, 'DeleteTargetGroup', {
      name: `${this.config.prefix}-tg`,
      protocol: 'HTTP',
      port: 80,
      targetType: 'instance',
      vpcId: `${this.config.prefix}-vpc`
    });
    this.applyDestroyPolicy(targetGroup);
  }

  private destroySecurityGroups(): void {
    const albSg = new ec2.CfnSecurityGroup(this, 'DeleteAlbSG', {
      groupName: `${this.config.prefix}-alb-sg`,
      groupDescription: 'Security group for ALB',
      vpcId: `${this.config.prefix}-vpc`
    });
    this.applyDestroyPolicy(albSg);

    const appSg = new ec2.CfnSecurityGroup(this, 'DeleteAppSG', {
      groupName: `${this.config.prefix}-app-sg`,
      groupDescription: 'Security group for Application',
      vpcId: `${this.config.prefix}-vpc`
    });
    this.applyDestroyPolicy(appSg);
  }

  private destroyEC2Resources(): void {
    const ec2Instance = new ec2.CfnInstance(this, 'DeleteEC2', {
      instanceType: 't2.micro',
      imageId: 'ami-dummy',
      tags: this.addNameTag('ec2')
    });
    this.applyDestroyPolicy(ec2Instance);
  }

  private destroyNetworkResources(): void {
    const vpc = new ec2.CfnVPC(this, 'DeleteVPC', {
      cidrBlock: this.config.vpcCidr,
      enableDnsHostnames: true,
      enableDnsSupport: true,
      tags: this.addNameTag('vpc')
    });
    this.applyDestroyPolicy(vpc);

    const subnet1a = new ec2.CfnSubnet(this, 'DeleteSubnet1a', {
      vpcId: `${this.config.prefix}-vpc`,
      cidrBlock: this.config.subnet1aCidr,
      availabilityZone: 'ap-northeast-1a',
      tags: this.addNameTag('public-subnet-1a')
    });
    this.applyDestroyPolicy(subnet1a);

    const subnet1c = new ec2.CfnSubnet(this, 'DeleteSubnet1c', {
      vpcId: `${this.config.prefix}-vpc`,
      cidrBlock: this.config.subnet1cCidr,
      availabilityZone: 'ap-northeast-1c',
      tags: this.addNameTag('public-subnet-1c')
    });
    this.applyDestroyPolicy(subnet1c);

    const rt1a = new ec2.CfnRouteTable(this, 'DeleteRouteTable1a', {
      vpcId: `${this.config.prefix}-vpc`,
      tags: this.addNameTag('public-rt-1a')
    });
    this.applyDestroyPolicy(rt1a);

    const rt1c = new ec2.CfnRouteTable(this, 'DeleteRouteTable1c', {
      vpcId: `${this.config.prefix}-vpc`,
      tags: this.addNameTag('public-rt-1c')
    });
    this.applyDestroyPolicy(rt1c);

    const igw = new ec2.CfnInternetGateway(this, 'DeleteIGW', {
      tags: this.addNameTag('igw')
    });
    this.applyDestroyPolicy(igw);
  }
}