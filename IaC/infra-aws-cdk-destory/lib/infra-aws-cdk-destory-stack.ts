import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as waf from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

export class InfraAwsCdkDestoryStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 特定のプレフィックスを持つリソースを削除
    const prefix = 'cdk-express-01';

    // VPC関連リソースの削除設定
    const vpc = new ec2.Vpc(this, 'VPC', {
      vpcName: `${prefix}-vpc`,
      maxAzs: 2,
    });

    // EC2インスタンスの削除設定
    new ec2.Instance(this, 'EC2Instance', {
      vpc,
      instanceName: `${prefix}-ec2`,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO),
      machineImage: new ec2.AmazonLinuxImage(),
    });

    // ALBの削除設定
    new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc,
      loadBalancerName: `${prefix}-alb`,
      internetFacing: true,
    });

    // S3バケットの削除設定
    const bucket = new s3.Bucket(this, 'Bucket', {
      bucketName: `${prefix}-s3`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true, // バケット内のオブジェクトも削除
    });

    // WAF Web ACLの削除設定
    const webAcl = new waf.CfnWebACL(this, 'WebACL', {
      name: `${prefix}-web-acl`,
      description: 'Web ACL for CloudFront',
      scope: 'CLOUDFRONT',
      defaultAction: {
        allow: {}
      },
      rules: [],
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `${prefix}-web-acl-metric`,
        sampledRequestsEnabled: true,
      },
    });

    // CloudFrontディストリビューションの削除設定（WAF付き）
    new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(bucket),
      },
      webAclId: webAcl.attrArn,
    });

    // IAMロールの削除設定
    new iam.Role(this, 'CustomRole', {
      roleName: `${prefix}-custom-role`,
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });
  }
}
