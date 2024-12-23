import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export class InfraAwsCdkVpcStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      ...props,
      env: {
        region: 'ap-northeast-1',
      },
    });

    // 接頭句 Cdk-Vpc-JS-Express-EJS-8080
    const prefix = 'Cdk-Vpc-JS-Express-EJS-8080';

    // VPCデフォルト
    const vpc = new ec2.Vpc(this, prefix, {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        }
      ],
    });

    // セキュリティグループ
    const securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc,
      description: 'Security group for Express.js application',
      allowAllOutbound: true,
    });

    // Port 8080
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(8080),
      'Allow inbound HTTP traffic on port 8080'
    );

    // Port 22
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      'Allow inbound SSH traffic on port 22'
    );
  }
}
