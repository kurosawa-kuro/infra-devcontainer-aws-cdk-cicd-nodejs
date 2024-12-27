import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as custom from 'aws-cdk-lib/custom-resources';
import * as iam from 'aws-cdk-lib/aws-iam';

const PREFIX = 'cdk-express-01';
const LOGICAL_PREFIX = 'CdkExpress01';
const CDK_TOOLKIT = 'CDKToolkit';
const CDK_ASSETS_BUCKET_PREFIX = 'cdk-hnb659fds-assets';

interface DestroyStackProps extends cdk.StackProps {
  prefix: string;
}

export class DestroyStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DestroyStackProps) {
    super(scope, id, {
      ...props,
      env: { region: 'ap-northeast-1' },
    });

    // Create a custom resource provider role with necessary permissions
    const providerRole: iam.Role = new iam.Role(this, `${LOGICAL_PREFIX}CustomResourceRole`, {
      roleName: `${PREFIX}-custom-resource-role`,
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
                'ec2:DescribeNetworkInterfaces',
                'ec2:RevokeSecurityGroupIngress',
                'ec2:RevokeSecurityGroupEgress',
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
                'elasticloadbalancing:DescribeTargetGroups',
                'elasticloadbalancing:ModifyLoadBalancerAttributes',
                'elasticloadbalancing:DeleteListener',
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
                's3:DeleteBucket',
                's3:GetObject',
                's3:ListAllMyBuckets',
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
                'cloudfront:UpdateDistribution',
                'cloudfront:GetDistributionConfig',
                'cloudfront:TagResource',
              ],
              resources: ['*'],
            }),
            // WAF permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'wafv2:DeleteWebACL',
                'wafv2:GetWebACL',
                'wafv2:ListWebACLs',
                'wafv2:UpdateWebACL',
                'wafv2:ListTagsForResource',
              ],
              resources: ['*'],
            }),
            // IAM permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'iam:DeleteRole',
                'iam:DeleteRolePolicy',
                'iam:ListRolePolicies',
                'iam:ListAttachedRolePolicies',
                'iam:DetachRolePolicy',
                'iam:GetRole',
              ],
              resources: ['*'],
            }),
            // CloudFormation permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'cloudformation:DeleteStack',
                'cloudformation:DescribeStacks',
                'cloudformation:ListStackResources',
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
            accountId: this.account,
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
import os

def handler(event, context):
    prefix = event['prefix']
    regions = event['regions']
    account_id = event['accountId']
    
    for region in regions:
        # Initialize clients
        ec2 = boto3.client('ec2', region_name=region)
        elb = boto3.client('elbv2', region_name=region)
        s3 = boto3.client('s3', region_name=region)
        cloudfront = boto3.client('cloudfront')
        wafv2 = boto3.client('wafv2', region_name='us-east-1')
        iam = boto3.client('iam')
        cf = boto3.client('cloudformation', region_name=region)
        
        # Delete EC2 instances
        instances = ec2.describe_instances(Filters=[{'Name': 'tag:Name', 'Values': [f'{prefix}*']}])
        for reservation in instances['Reservations']:
            for instance in reservation['Instances']:
                ec2.terminate_instances(InstanceIds=[instance['InstanceId']])
        
        # Delete Load Balancers and Target Groups
        lbs = elb.describe_load_balancers()
        for lb in lbs['LoadBalancers']:
            if prefix in lb['LoadBalancerName']:
                # Delete listeners first
                listeners = elb.describe_listeners(LoadBalancerArn=lb['LoadBalancerArn'])
                for listener in listeners['Listeners']:
                    elb.delete_listener(ListenerArn=listener['ListenerArn'])
                # Then delete the load balancer
                elb.delete_load_balancer(LoadBalancerArn=lb['LoadBalancerArn'])
                
        # Wait for load balancers to be deleted
        time.sleep(30)
        
        # Delete target groups
        target_groups = elb.describe_target_groups()
        for tg in target_groups['TargetGroups']:
            if prefix in tg.get('TargetGroupName', ''):
                elb.delete_target_group(TargetGroupArn=tg['TargetGroupArn'])
        
        # Delete Security Groups
        sgs = ec2.describe_security_groups(Filters=[{'Name': 'group-name', 'Values': [f'{prefix}*']}])
        for sg in sgs['SecurityGroups']:
            try:
                # Remove all inbound and outbound rules first
                ec2.revoke_security_group_ingress(
                    GroupId=sg['GroupId'],
                    IpPermissions=sg['IpPermissions']
                )
                ec2.revoke_security_group_egress(
                    GroupId=sg['GroupId'],
                    IpPermissions=sg['IpPermissionsEgress']
                )
                # Then delete the security group
                ec2.delete_security_group(GroupId=sg['GroupId'])
            except Exception as e:
                print(f"Error deleting security group {sg['GroupId']}: {str(e)}")
        
        # Delete S3 buckets
        buckets = s3.list_buckets()
        for bucket in buckets['Buckets']:
            if prefix in bucket['Name'] or f"{CDK_ASSETS_BUCKET_PREFIX}-{account_id}" in bucket['Name']:
                try:
                    # Empty the bucket first
                    s3_resource = boto3.resource('s3', region_name=region)
                    bucket_obj = s3_resource.Bucket(bucket['Name'])
                    bucket_obj.objects.all().delete()
                    bucket_obj.object_versions.all().delete()
                    # Then delete the bucket
                    s3.delete_bucket(Bucket=bucket['Name'])
                except Exception as e:
                    print(f"Error deleting bucket {bucket['Name']}: {str(e)}")
        
        # Delete CloudFront distributions
        if region == 'us-east-1':
            dists = cloudfront.list_distributions()
            if 'Items' in dists['DistributionList']:
                for dist in dists['DistributionList']['Items']:
                    if prefix in dist.get('Comment', ''):
                        try:
                            # Disable distribution first
                            dist_config = cloudfront.get_distribution_config(Id=dist['Id'])
                            if dist_config['DistributionConfig']['Enabled']:
                                dist_config['DistributionConfig']['Enabled'] = False
                                cloudfront.update_distribution(
                                    Id=dist['Id'],
                                    IfMatch=dist_config['ETag'],
                                    DistributionConfig=dist_config['DistributionConfig']
                                )
                                # Wait for deployment to complete
                                while True:
                                    status = cloudfront.get_distribution(Id=dist['Id'])
                                    if status['Distribution']['Status'] == 'Deployed':
                                        break
                                    time.sleep(30)
                            
                            # Delete distribution
                            dist_config = cloudfront.get_distribution(Id=dist['Id'])
                            cloudfront.delete_distribution(
                                Id=dist['Id'],
                                IfMatch=dist_config['ETag']
                            )
                        except Exception as e:
                            print(f"Error deleting distribution {dist['Id']}: {str(e)}")
        
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
                    except Exception as e:
                        print(f"Error deleting WAF ACL {acl['Name']}: {str(e)}")
        
        # Delete VPC resources
        vpcs = ec2.describe_vpcs(Filters=[{'Name': 'tag:Name', 'Values': [f'{prefix}*']}])
        for vpc in vpcs['Vpcs']:
            try:
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
                
                # Delete Network Interfaces
                enis = ec2.describe_network_interfaces(
                    Filters=[{'Name': 'vpc-id', 'Values': [vpc['VpcId']]}]
                )
                for eni in enis['NetworkInterfaces']:
                    ec2.delete_network_interface(NetworkInterfaceId=eni['NetworkInterfaceId'])
                
                # Finally delete the VPC
                ec2.delete_vpc(VpcId=vpc['VpcId'])
            except Exception as e:
                print(f"Error deleting VPC resources for {vpc['VpcId']}: {str(e)}")
        
        # Delete CDK Toolkit roles
        try:
            role_name = f'cdk-{CDK_ASSETS_BUCKET_PREFIX}-cfn-exec-role-{account_id}-{region}'
            role = iam.get_role(RoleName=role_name)
            
            # Detach managed policies
            attached_policies = iam.list_attached_role_policies(RoleName=role_name)
            for policy in attached_policies['AttachedPolicies']:
                iam.detach_role_policy(
                    RoleName=role_name,
                    PolicyArn=policy['PolicyArn']
                )
            
            # Delete inline policies
            inline_policies = iam.list_role_policies(RoleName=role_name)
            for policy_name in inline_policies['PolicyNames']:
                iam.delete_role_policy(
                    RoleName=role_name,
                    PolicyName=policy_name
                )
            
            # Delete the role
            iam.delete_role(RoleName=role_name)
        except Exception as e:
            print(f"Error deleting CDK Toolkit role in {region}: {str(e)}")
        
        # Delete CDK Toolkit stack
        try:
            cf.delete_stack(StackName=CDK_TOOLKIT)
            waiter = cf.get_waiter('stack_delete_complete')
            waiter.wait(StackName=CDK_TOOLKIT)
        except Exception as e:
            print(f"Error deleting CDK Toolkit stack in {region}: {str(e)}")
    
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
        'iam:*',
        'cloudformation:*',
      ],
      resources: ['*'],
    }));
  }
}