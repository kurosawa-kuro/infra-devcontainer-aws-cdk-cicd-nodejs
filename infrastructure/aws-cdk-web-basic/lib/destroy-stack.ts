import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as cr from 'aws-cdk-lib/custom-resources';

const PREFIX = 'CdkExpress02';

export class DestroyStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Delete resources in reverse order of dependencies
    this.deleteCloudFrontResources();
    this.deleteLoadBalancerResources();
    this.deleteEC2Resources();
    this.deleteNetworkResources();
    this.deleteS3Resources();
  }

  private deleteCloudFrontResources() {
    // Delete CloudFront Distribution
    new cr.AwsCustomResource(this, 'DeleteCloudFrontDistribution', {
      onDelete: {
        service: 'CloudFront',
        action: 'deleteDistribution',
        parameters: {
          Id: `${PREFIX}-distribution`
        },
        physicalResourceId: cr.PhysicalResourceId.of('DeleteCloudFrontDistribution')
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE
      })
    });

    // Delete Cache Policy
    new cr.AwsCustomResource(this, 'DeleteCachePolicy', {
      onDelete: {
        service: 'CloudFront',
        action: 'deleteCachePolicy',
        parameters: {
          Id: `${PREFIX}-cache-policy`
        },
        physicalResourceId: cr.PhysicalResourceId.of('DeleteCachePolicy')
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE
      })
    });
  }

  private deleteLoadBalancerResources() {
    // Delete ALB
    new cr.AwsCustomResource(this, 'DeleteALB', {
      onDelete: {
        service: 'ELBv2',
        action: 'deleteLoadBalancer',
        parameters: {
          LoadBalancerArn: `${PREFIX}-alb`
        },
        physicalResourceId: cr.PhysicalResourceId.of('DeleteALB')
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE
      })
    });

    // Delete Target Group
    new cr.AwsCustomResource(this, 'DeleteTargetGroup', {
      onDelete: {
        service: 'ELBv2',
        action: 'deleteTargetGroup',
        parameters: {
          TargetGroupArn: `${PREFIX}-tg`
        },
        physicalResourceId: cr.PhysicalResourceId.of('DeleteTargetGroup')
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE
      })
    });
  }

  private deleteEC2Resources() {
    // Delete EC2 Instance
    new cr.AwsCustomResource(this, 'DeleteEC2Instance', {
      onDelete: {
        service: 'EC2',
        action: 'terminateInstances',
        parameters: {
          InstanceIds: [`${PREFIX}-ec2`]
        },
        physicalResourceId: cr.PhysicalResourceId.of('DeleteEC2Instance')
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE
      })
    });

    // Delete Security Groups
    ['alb-sg', 'app-sg'].forEach(sgName => {
      new cr.AwsCustomResource(this, `DeleteSecurityGroup-${sgName}`, {
        onDelete: {
          service: 'EC2',
          action: 'deleteSecurityGroup',
          parameters: {
            GroupName: `${PREFIX}-${sgName}`
          },
          physicalResourceId: cr.PhysicalResourceId.of(`DeleteSecurityGroup-${sgName}`)
        },
        policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
          resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE
        })
      });
    });
  }

  private deleteNetworkResources() {
    // Delete Route Tables
    ['public-rt-1a', 'public-rt-1c'].forEach(rtName => {
      new cr.AwsCustomResource(this, `DeleteRouteTable-${rtName}`, {
        onDelete: {
          service: 'EC2',
          action: 'deleteRouteTable',
          parameters: {
            RouteTableId: `${PREFIX}-${rtName}`
          },
          physicalResourceId: cr.PhysicalResourceId.of(`DeleteRouteTable-${rtName}`)
        },
        policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
          resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE
        })
      });
    });

    // Delete Subnets
    ['public-subnet-1a', 'public-subnet-1c'].forEach(subnetName => {
      new cr.AwsCustomResource(this, `DeleteSubnet-${subnetName}`, {
        onDelete: {
          service: 'EC2',
          action: 'deleteSubnet',
          parameters: {
            SubnetId: `${PREFIX}-${subnetName}`
          },
          physicalResourceId: cr.PhysicalResourceId.of(`DeleteSubnet-${subnetName}`)
        },
        policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
          resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE
        })
      });
    });

    // Delete Internet Gateway
    new cr.AwsCustomResource(this, 'DeleteInternetGateway', {
      onDelete: {
        service: 'EC2',
        action: 'deleteInternetGateway',
        parameters: {
          InternetGatewayId: `${PREFIX}-igw`
        },
        physicalResourceId: cr.PhysicalResourceId.of('DeleteInternetGateway')
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE
      })
    });

    // Delete VPC
    new cr.AwsCustomResource(this, 'DeleteVPC', {
      onDelete: {
        service: 'EC2',
        action: 'deleteVpc',
        parameters: {
          VpcId: `${PREFIX}-vpc`
        },
        physicalResourceId: cr.PhysicalResourceId.of('DeleteVPC')
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE
      })
    });
  }

  private deleteS3Resources() {
    // Delete S3 Bucket
    new cr.AwsCustomResource(this, 'DeleteS3Bucket', {
      onDelete: {
        service: 'S3',
        action: 'deleteBucket',
        parameters: {
          Bucket: `${PREFIX}-s3`
        },
        physicalResourceId: cr.PhysicalResourceId.of('DeleteS3Bucket')
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE
      })
    });
  }
}