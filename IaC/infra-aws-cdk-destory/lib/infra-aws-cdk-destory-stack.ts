import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as cfn from 'aws-cdk-lib/aws-cloudformation';
import { Construct } from 'constructs';

const CONFIG = {
  prefix: 'cdk-express-01',
  region: 'ap-northeast-1',
  vpc: {
    cidr: '10.0.0.0/16',
    maxAzs: 2,
    subnetMask: 24,
  },
  cloudformation: {
    stacks: [
      'cdk-express-01-vpc-alb-ami-s3-cloudfront-stack',
      'cdk-express-01-web-acl-stack',
    ]
  }
} as const;

export class InfraAwsCdkDestoryStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      ...props,
      env: { region: CONFIG.region },
      crossRegionReferences: true,
    });

    // CloudFormationスタックの削除設定
    CONFIG.cloudformation.stacks.forEach((stackName) => {
      new cfn.CfnStack(this, `Delete-${stackName}`, {
        templateUrl: 'https://s3.amazonaws.com/cloudformation-templates-us-east-1/EmptyStack.template',
        parameters: {},
        timeoutInMinutes: 60,
      }).addDeletionOverride('*');
    });

    // VPC関連リソースの削除設定
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

    // セキュリティグループの削除設定
    const albSg = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc,
      securityGroupName: `${CONFIG.prefix}-alb-security-group`,
      description: 'Security group for ALB',
      allowAllOutbound: true,
    });

    const appSg = new ec2.SecurityGroup(this, 'AppSecurityGroup', {
      vpc,
      securityGroupName: `${CONFIG.prefix}-app-security-group`,
      description: 'Security group for App',
      allowAllOutbound: true,
    });

    // EC2インスタンスの削除設定
    new ec2.Instance(this, 'AppInstance', {
      vpc,
      instanceName: `${CONFIG.prefix}-instance`,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO),
      machineImage: ec2.MachineImage.genericLinux({
        [CONFIG.region]: 'ami-0d6308af452376e20',
      }),
      securityGroup: appSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      blockDevices: [{
        deviceName: '/dev/xvda',
        volume: ec2.BlockDeviceVolume.ebs(10),
      }],
    });

    // ALBの削除設定
    new elbv2.ApplicationLoadBalancer(this, 'AppLoadBalancer', {
      vpc,
      internetFacing: true,
      loadBalancerName: `${CONFIG.prefix}-load-balancer`,
      securityGroup: albSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    // S3バケットの削除設定
    const bucket = new s3.Bucket(this, 'StaticContentBucket', {
      bucketName: `${CONFIG.prefix}-bucket`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // WAF Web ACLの削除設定（us-east-1リージョン）
    const webAclStack = new cdk.Stack(scope as cdk.App, `${CONFIG.prefix}-web-acl-stack`, {
      env: { region: 'us-east-1' },
      crossRegionReferences: true,
    });

    const webAcl = new wafv2.CfnWebACL(webAclStack, `${CONFIG.prefix}-cloudfront-web-acl`, {
      defaultAction: { allow: {} },
      scope: 'CLOUDFRONT',
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `${CONFIG.prefix}-cloudfront-waf-metric`,
        sampledRequestsEnabled: true,
      },
      rules: [],
      name: `${CONFIG.prefix}-cloudfront-waf`,
      description: 'WAF rules for CloudFront distribution'
    });

    // CloudFront Origin Access Control
    const oac = new cloudfront.CfnOriginAccessControl(this, 'CloudFrontOAC', {
      originAccessControlConfig: {
        name: `${CONFIG.prefix}-origin-access-control`,
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4'
      }
    });

    // CloudFrontディストリビューションの削除設定
    const distribution = new cloudfront.Distribution(this, 'StaticContentDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
        compress: true,
      },
      webAclId: webAcl.attrArn,
      comment: 'CDN for S3 static content',
      defaultRootObject: 'index.html',
      enableIpv6: true,
      httpVersion: cloudfront.HttpVersion.HTTP2,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
    });

    // CloudFront OACの設定
    const cfnDistribution = distribution.node.defaultChild as cloudfront.CfnDistribution;
    cfnDistribution.addPropertyOverride('DistributionConfig.Origins.0.S3OriginConfig.OriginAccessIdentity', '');
    cfnDistribution.addPropertyOverride('DistributionConfig.Origins.0.OriginAccessControlId', oac.ref);

    // バケットポリシーの削除設定
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
}
