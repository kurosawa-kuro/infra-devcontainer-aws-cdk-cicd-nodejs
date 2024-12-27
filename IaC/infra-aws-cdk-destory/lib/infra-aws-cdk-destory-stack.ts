import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as custom from 'aws-cdk-lib/custom-resources';
import * as iam from 'aws-cdk-lib/aws-iam';

interface DestroyStackProps extends cdk.StackProps {
  prefix: string;
}

export class InfraAwsCdkDestoryStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DestroyStackProps) {
    super(scope, id, props);

    // Create a custom resource provider role with necessary permissions
    const providerRole = new iam.Role(this, 'CustomResourceRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        'ResourceCleanup': new iam.PolicyDocument({
          statements: [
            // EC2 permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'ec2:DescribeInstances',
                'ec2:TerminateInstances',
                'ec2:DeleteSecurityGroup',
                'ec2:DescribeSecurityGroups',
                'ec2:DeleteVpc',
                'ec2:DescribeVpcs',
                'ec2:DetachInternetGateway',
                'ec2:DeleteInternetGateway',
                'ec2:DescribeInternetGateways',
                'ec2:DeleteSubnet',
                'ec2:DescribeSubnets',
                'ec2:DeleteRouteTable',
                'ec2:DisassociateRouteTable',
                'ec2:DescribeRouteTables',
                'ec2:DeleteNetworkInterface',
                'ec2:DescribeNetworkInterfaces'
              ],
              resources: ['*'],
            }),
            // ELB permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'elasticloadbalancing:DeleteLoadBalancer',
                'elasticloadbalancing:DescribeLoadBalancers',
                'elasticloadbalancing:DeleteTargetGroup',
                'elasticloadbalancing:DescribeTargetGroups'
              ],
              resources: ['*'],
            }),
            // S3 permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:DeleteObject',
                's3:DeleteObjectVersion',
                's3:ListBucket',
                's3:ListBucketVersions',
                's3:DeleteBucket'
              ],
              resources: ['*'],
            }),
            // CloudFront permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'cloudfront:DeleteDistribution',
                'cloudfront:GetDistribution',
                'cloudfront:ListDistributions',
                'cloudfront:UpdateDistribution'
              ],
              resources: ['*'],
            }),
            // WAF permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'wafv2:DeleteWebACL',
                'wafv2:GetWebACL',
                'wafv2:ListWebACLs'
              ],
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    // Create a custom resource to handle resource cleanup
    new custom.AwsCustomResource(this, 'ResourceCleanup', {
      onCreate: {
        service: 'CloudFormation',
        action: 'describeStacks',
        parameters: {
          StackName: props.prefix,
        },
        physicalResourceId: custom.PhysicalResourceId.of('ResourceCleanupId'),
      },
      onDelete: {
        service: 'Lambda',
        action: 'invoke',
        parameters: {
          FunctionName: 'cleanupResources',
          Payload: JSON.stringify({
            prefix: props.prefix,
            regions: ['ap-northeast-1', 'us-east-1'],
          }),
        },
      },
      policy: custom.AwsCustomResourcePolicy.fromSdkCalls({
        resources: custom.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
      role: providerRole,
    });

    // Lambda function to handle resource cleanup
    const cleanupFunction = new cdk.aws_lambda.Function(this, 'CleanupFunction', {
      runtime: cdk.aws_lambda.Runtime.PYTHON_3_9,
      handler: 'index.handler',
      code: cdk.aws_lambda.Code.fromInline(`
import boto3
import json
import time

def handler(event, context):
    prefix = event['prefix']
    regions = event['regions']
    
    for region in regions:
        # Initialize clients
        ec2 = boto3.client('ec2', region_name=region)
        elb = boto3.client('elbv2', region_name=region)
        s3 = boto3.client('s3', region_name=region)
        cloudfront = boto3.client('cloudfront')
        wafv2 = boto3.client('wafv2', region_name='us-east-1')
        
        # Delete EC2 instances
        instances = ec2.describe_instances(Filters=[{'Name': 'tag:Name', 'Values': [f'{prefix}*']}])
        for reservation in instances['Reservations']:
            for instance in reservation['Instances']:
                ec2.terminate_instances(InstanceIds=[instance['InstanceId']])
        
        # Delete Load Balancers
        lbs = elb.describe_load_balancers()
        for lb in lbs['LoadBalancers']:
            if prefix in lb['LoadBalancerName']:
                elb.delete_load_balancer(LoadBalancerArn=lb['LoadBalancerArn'])
        
        # Delete Security Groups
        sgs = ec2.describe_security_groups(Filters=[{'Name': 'group-name', 'Values': [f'{prefix}*']}])
        for sg in sgs['SecurityGroups']:
            try:
                ec2.delete_security_group(GroupId=sg['GroupId'])
            except:
                pass
        
        # Delete S3 buckets
        buckets = s3.list_buckets()
        for bucket in buckets['Buckets']:
            if prefix in bucket['Name']:
                try:
                    s3.delete_bucket(Bucket=bucket['Name'])
                except:
                    pass
        
        # Delete CloudFront distributions
        if region == 'us-east-1':
            dists = cloudfront.list_distributions()
            if 'Items' in dists['DistributionList']:
                for dist in dists['DistributionList']['Items']:
                    if prefix in dist['Comment']:
                        try:
                            cloudfront.delete_distribution(
                                Id=dist['Id'],
                                IfMatch=cloudfront.get_distribution(Id=dist['Id'])['ETag']
                            )
                        except:
                            pass
        
            # Delete WAF Web ACLs
            acls = wafv2.list_web_acls(Scope='CLOUDFRONT')
            for acl in acls['WebACLs']:
                if prefix in acl['Name']:
                    try:
                        wafv2.delete_web_acl(
                            Name=acl['Name'],
                            Id=acl['Id'],
                            LockToken=wafv2.get_web_acl(
                                Name=acl['Name'],
                                Id=acl['Id'],
                                Scope='CLOUDFRONT'
                            )['LockToken'],
                            Scope='CLOUDFRONT'
                        )
                    except:
                        pass
        
        # Delete VPC resources
        vpcs = ec2.describe_vpcs(Filters=[{'Name': 'tag:Name', 'Values': [f'{prefix}*']}])
        for vpc in vpcs['Vpcs']:
            # Delete Internet Gateways
            igws = ec2.describe_internet_gateways(
                Filters=[{'Name': 'attachment.vpc-id', 'Values': [vpc['VpcId']]}]
            )
            for igw in igws['InternetGateways']:
                ec2.detach_internet_gateway(InternetGatewayId=igw['InternetGatewayId'], VpcId=vpc['VpcId'])
                ec2.delete_internet_gateway(InternetGatewayId=igw['InternetGatewayId'])
            
            # Delete Subnets
            subnets = ec2.describe_subnets(Filters=[{'Name': 'vpc-id', 'Values': [vpc['VpcId']]}])
            for subnet in subnets['Subnets']:
                ec2.delete_subnet(SubnetId=subnet['SubnetId'])
            
            # Delete Route Tables
            rts = ec2.describe_route_tables(Filters=[{'Name': 'vpc-id', 'Values': [vpc['VpcId']]}])
            for rt in rts['RouteTables']:
                if not rt['Associations'] or not rt['Associations'][0]['Main']:
                    for assoc in rt['Associations']:
                        ec2.disassociate_route_table(AssociationId=assoc['RouteTableAssociationId'])
                    ec2.delete_route_table(RouteTableId=rt['RouteTableId'])
            
            # Delete VPC
            try:
                ec2.delete_vpc(VpcId=vpc['VpcId'])
            except:
                pass
    
    return {
        'statusCode': 200,
        'body': json.dumps('Cleanup completed')
    }
`),
      timeout: cdk.Duration.minutes(15),
      memorySize: 512,
    });

    // Grant the cleanup function necessary permissions
    cleanupFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ec2:*',
        'elasticloadbalancing:*',
        's3:*',
        'cloudfront:*',
        'wafv2:*',
      ],
      resources: ['*'],
    }));
  }
}
