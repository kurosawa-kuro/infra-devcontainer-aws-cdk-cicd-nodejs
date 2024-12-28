import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as custom from 'aws-cdk-lib/custom-resources';
import * as iam from 'aws-cdk-lib/aws-iam';

/**
 * Constants for stack and resource naming
 */
const AWS_ACCOUNT_ID = '476114153361';
const PREFIX = 'cdk-express-01';
const LOGICAL_PREFIX = 'CdkExpress01';
const CDK_TOOLKIT = 'CDKToolkit';
const CDK_ASSETS_BUCKET_PREFIX = 'cdk-hnb659fds-assets';
const REGIONS = ['ap-northeast-1', 'us-east-1'] as const;
const MAIN_STACK = 'InfraAwsCdkVpcAlbAmiS3CloudfrontStack';
const STACK_STATUS_PATTERNS = {
  FAILED_STATES: ['DELETE_FAILED', 'ROLLBACK_FAILED', 'UPDATE_ROLLBACK_FAILED'] as const
};

interface DestroyStackProps extends cdk.StackProps {
  prefix: string;
}

/**
 * Stack for cleaning up all resources created by the main stack
 */
export class DestroyStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DestroyStackProps) {
    super(scope, id, {
      ...props,
      stackName: 'DestroyStack',
      env: { region: 'ap-northeast-1', account: AWS_ACCOUNT_ID },
    });

    // Create the pre-check function to handle failed stacks
    const preCheckFunction = this.createPreCheckFunction();

    // Create the main cleanup function
    const cleanupFunction = this.createCleanupFunction();
    this.addCleanupFunctionPermissions(cleanupFunction);

    // Create the custom resource role and cleanup resource
    const providerRole = this.createCustomResourceRole(cleanupFunction.functionArn);
    this.createResourceCleanupCustomResource(providerRole, preCheckFunction);
  }

  /**
   * Creates a Lambda function to check for and handle failed stacks
   */
  private createPreCheckFunction(): cdk.aws_lambda.Function {
    const preCheckRole = new iam.Role(this, 'PreCheckRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        'PreCheckPolicy': new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'cloudformation:DescribeStacks',
                'cloudformation:DeleteStack',
              ],
              resources: [
                `arn:aws:cloudformation:ap-northeast-1:${AWS_ACCOUNT_ID}:stack/DestroyStack/*`,
                `arn:aws:cloudformation:ap-northeast-1:${AWS_ACCOUNT_ID}:stack/${MAIN_STACK}/*`,
                `arn:aws:cloudformation:us-east-1:${AWS_ACCOUNT_ID}:stack/${MAIN_STACK}/*`
              ],
            }),
          ],
        }),
      },
    });

    return new cdk.aws_lambda.Function(this, 'PreCheckFunction', {
      runtime: cdk.aws_lambda.Runtime.PYTHON_3_9,
      handler: 'index.handler',
      code: cdk.aws_lambda.Code.fromInline(this.getPreCheckFunctionCode()),
      timeout: cdk.Duration.minutes(5),
      role: preCheckRole,
    });
  }

  /**
   * Creates the main cleanup Lambda function
   */
  private createCleanupFunction(): cdk.aws_lambda.Function {
    return new cdk.aws_lambda.Function(this, `${LOGICAL_PREFIX}CleanupFunction`, {
      functionName: `${PREFIX}-cleanupResources`,
      runtime: cdk.aws_lambda.Runtime.PYTHON_3_9,
      handler: 'index.handler',
      code: cdk.aws_lambda.Code.fromInline(this.getCleanupFunctionCode()),
      timeout: cdk.Duration.minutes(15),
      memorySize: 512,
    });
  }

  /**
   * Adds required permissions to the cleanup function
   */
  private addCleanupFunctionPermissions(cleanupFunction: cdk.aws_lambda.Function): void {
    cleanupFunction.addToRolePolicy(
      new iam.PolicyStatement({
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
      })
    );
  }

  /**
   * Creates the custom resource role with necessary permissions
   */
  private createCustomResourceRole(functionArn: string): iam.Role {
    const policyStatements = [
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
        resources: [
          `arn:aws:iam::${AWS_ACCOUNT_ID}:role/${PREFIX}-*`,
          `arn:aws:iam::${AWS_ACCOUNT_ID}:role/cdk-${CDK_ASSETS_BUCKET_PREFIX}-*`
        ],
      }),
      // CloudFormation permissions
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cloudformation:DeleteStack',
          'cloudformation:DescribeStacks',
          'cloudformation:ListStackResources',
        ],
        resources: [
          `arn:aws:cloudformation:ap-northeast-1:${AWS_ACCOUNT_ID}:stack/${CDK_TOOLKIT}/*`,
          `arn:aws:cloudformation:us-east-1:${AWS_ACCOUNT_ID}:stack/${CDK_TOOLKIT}/*`,
          `arn:aws:cloudformation:ap-northeast-1:${AWS_ACCOUNT_ID}:stack/${MAIN_STACK}/*`,
          `arn:aws:cloudformation:us-east-1:${AWS_ACCOUNT_ID}:stack/${MAIN_STACK}/*`,
          `arn:aws:cloudformation:ap-northeast-1:${AWS_ACCOUNT_ID}:stack/DestroyStack/*`
        ],
      }),
      // Lambda invoke permissions
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [
          `arn:aws:lambda:ap-northeast-1:${AWS_ACCOUNT_ID}:function:${PREFIX}-cleanupResources`,
          functionArn
        ],
      }),
    ];

    return new iam.Role(this, `${LOGICAL_PREFIX}CustomResourceRole`, {
      roleName: `${PREFIX}-custom-resource-role`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        'ResourceCleanup': new iam.PolicyDocument({
          statements: policyStatements,
        }),
      },
    });
  }

  /**
   * Creates the custom resource for cleanup orchestration
   */
  private createResourceCleanupCustomResource(providerRole: iam.Role, preCheckFunction: cdk.aws_lambda.Function): void {
    new custom.AwsCustomResource(this, 'ResourceCleanup', {
      onCreate: {
        service: 'Lambda',
        action: 'invoke',
        parameters: {
          FunctionName: preCheckFunction.functionName,
          Payload: JSON.stringify({
            regions: REGIONS,
            stackNames: ['DestroyStack', MAIN_STACK],
            accountId: AWS_ACCOUNT_ID,
          }),
        },
        physicalResourceId: custom.PhysicalResourceId.of('PreCheckId'),
      },
      onDelete: {
        service: 'Lambda',
        action: 'invoke',
        parameters: {
          FunctionName: `${PREFIX}-cleanupResources`,
          Payload: JSON.stringify({
            prefix: PREFIX,
            regions: REGIONS,
            accountId: this.account,
          }),
        },
      },
      policy: custom.AwsCustomResourcePolicy.fromSdkCalls({
        resources: custom.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
      role: providerRole,
    });
  }

  /**
   * Gets the code for the pre-check Lambda function
   */
  private getPreCheckFunctionCode(): string {
    return `
import boto3
import json

def handler(event, context):
    regions = event['regions']
    stack_names = event['stackNames']
    account_id = event['accountId']
    failed_stacks = []
    
    for region in regions:
        cf = boto3.client('cloudformation', region_name=region)
        for stack_name in stack_names:
            try:
                response = cf.describe_stacks(StackName=stack_name)
                for stack in response['Stacks']:
                    status = stack['StackStatus']
                    if status in ['DELETE_FAILED', 'ROLLBACK_FAILED', 'UPDATE_ROLLBACK_FAILED']:
                        failed_stacks.append({
                            'region': region,
                            'stack_name': stack_name,
                            'status': status,
                            'stack_id': stack['StackId']
                        })
                        print(f"Found failed stack: {stack_name} in {region} with status {status}")
                        print(f"Stack ID: {stack['StackId']}")
                        cf.delete_stack(StackName=stack_name)
                        waiter = cf.get_waiter('stack_delete_complete')
                        waiter.wait(StackName=stack_name)
                        print(f"Successfully deleted failed stack: {stack_name} in {region}")
            except cf.exceptions.ClientError as e:
                if 'does not exist' not in str(e):
                    print(f"Error checking stack {stack_name} in {region}: {str(e)}")
    
    return {
        'statusCode': 200,
        'body': json.dumps({
            'message': 'Pre-check completed',
            'failed_stacks': failed_stacks,
            'account_id': account_id
        })
    }
`;
  }

  /**
   * Gets the code for the cleanup Lambda function
   */
  private getCleanupFunctionCode(): string {
    return `
import boto3
import json
import time

def handler(event, context):
    prefix = event['prefix']
    regions = event['regions']
    account_id = event['accountId']
    
    for region in regions:
        cleanup_resources_in_region(region, prefix, account_id)
    
    return {
        'statusCode': 200,
        'body': json.dumps('Cleanup completed')
    }

def cleanup_resources_in_region(region, prefix, account_id):
    # Initialize clients
    ec2 = boto3.client('ec2', region_name=region)
    elb = boto3.client('elbv2', region_name=region)
    s3 = boto3.client('s3', region_name=region)
    cloudfront = boto3.client('cloudfront')
    wafv2 = boto3.client('wafv2', region_name='us-east-1')
    iam = boto3.client('iam')
    cf = boto3.client('cloudformation', region_name=region)
    
    # Clean up main stack first if it exists
    try:
        stacks = cf.describe_stacks(StackName='InfraAwsCdkVpcAlbAmiS3CloudfrontStack')
        if stacks['Stacks'][0]['StackStatus'] in ['DELETE_FAILED', 'ROLLBACK_FAILED', 'UPDATE_ROLLBACK_FAILED']:
            print(f"Found main stack in failed state in {region}, forcing deletion...")
        cf.delete_stack(StackName='InfraAwsCdkVpcAlbAmiS3CloudfrontStack')
        waiter = cf.get_waiter('stack_delete_complete')
        waiter.wait(StackName='InfraAwsCdkVpcAlbAmiS3CloudfrontStack')
    except cf.exceptions.ClientError as e:
        if 'does not exist' not in str(e):
            print(f"Error deleting main stack in {region}: {str(e)}")
    
    cleanup_ec2_resources(ec2, prefix)
    cleanup_load_balancers(elb, prefix)
    cleanup_s3_buckets(s3, prefix, account_id, region)
    
    if region == 'us-east-1':
        cleanup_cloudfront_distributions(cloudfront, prefix)
        cleanup_waf_acls(wafv2, prefix)
    
    cleanup_vpc_resources(ec2, prefix)
    cleanup_cdk_toolkit_resources(iam, cf, account_id, region)

def cleanup_ec2_resources(ec2, prefix):
    instances = ec2.describe_instances(Filters=[{'Name': 'tag:Name', 'Values': [f'{prefix}*']}])
    for reservation in instances['Reservations']:
        for instance in reservation['Instances']:
            ec2.terminate_instances(InstanceIds=[instance['InstanceId']])

def cleanup_load_balancers(elb, prefix):
    lbs = elb.describe_load_balancers()
    for lb in lbs['LoadBalancers']:
        if prefix in lb['LoadBalancerName']:
            delete_load_balancer_resources(elb, lb)
    
    time.sleep(30)
    cleanup_target_groups(elb, prefix)

def delete_load_balancer_resources(elb, lb):
    listeners = elb.describe_listeners(LoadBalancerArn=lb['LoadBalancerArn'])
    for listener in listeners['Listeners']:
        elb.delete_listener(ListenerArn=listener['ListenerArn'])
    elb.delete_load_balancer(LoadBalancerArn=lb['LoadBalancerArn'])

def cleanup_target_groups(elb, prefix):
    target_groups = elb.describe_target_groups()
    for tg in target_groups['TargetGroups']:
        if prefix in tg.get('TargetGroupName', ''):
            elb.delete_target_group(TargetGroupArn=tg['TargetGroupArn'])

def cleanup_s3_buckets(s3, prefix, account_id, region):
    buckets = s3.list_buckets()
    for bucket in buckets['Buckets']:
        if prefix in bucket['Name'] or f"cdk-hnb659fds-assets-{account_id}" in bucket['Name']:
            try:
                empty_and_delete_bucket(s3, bucket['Name'], region)
            except Exception as e:
                print(f"Error deleting bucket {bucket['Name']}: {str(e)}")

def empty_and_delete_bucket(s3, bucket_name, region):
    s3_resource = boto3.resource('s3', region_name=region)
    bucket_obj = s3_resource.Bucket(bucket_name)
    bucket_obj.objects.all().delete()
    bucket_obj.object_versions.all().delete()
    s3.delete_bucket(Bucket=bucket_name)

def cleanup_cloudfront_distributions(cloudfront, prefix):
    dists = cloudfront.list_distributions()
    if 'Items' in dists['DistributionList']:
        for dist in dists['DistributionList']['Items']:
            if prefix in dist.get('Comment', ''):
                try:
                    disable_and_delete_distribution(cloudfront, dist)
                except Exception as e:
                    print(f"Error deleting distribution {dist['Id']}: {str(e)}")

def disable_and_delete_distribution(cloudfront, dist):
    dist_config = cloudfront.get_distribution_config(Id=dist['Id'])
    if dist_config['DistributionConfig']['Enabled']:
        disable_distribution(cloudfront, dist, dist_config)
    
    dist_config = cloudfront.get_distribution(Id=dist['Id'])
    cloudfront.delete_distribution(
        Id=dist['Id'],
        IfMatch=dist_config['ETag']
    )

def disable_distribution(cloudfront, dist, dist_config):
    dist_config['DistributionConfig']['Enabled'] = False
    cloudfront.update_distribution(
        Id=dist['Id'],
        IfMatch=dist_config['ETag'],
        DistributionConfig=dist_config['DistributionConfig']
    )
    wait_for_distribution_deployment(cloudfront, dist['Id'])

def wait_for_distribution_deployment(cloudfront, dist_id):
    while True:
        status = cloudfront.get_distribution(Id=dist_id)
        if status['Distribution']['Status'] == 'Deployed':
            break
        time.sleep(30)

def cleanup_waf_acls(wafv2, prefix):
    acls = wafv2.list_web_acls(Scope='CLOUDFRONT')
    for acl in acls['WebACLs']:
        if prefix in acl['Name']:
            try:
                delete_waf_acl(wafv2, acl)
            except Exception as e:
                print(f"Error deleting WAF ACL {acl['Name']}: {str(e)}")

def delete_waf_acl(wafv2, acl):
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

def cleanup_vpc_resources(ec2, prefix):
    vpcs = ec2.describe_vpcs(Filters=[{'Name': 'tag:Name', 'Values': [f'{prefix}*']}])
    for vpc in vpcs['Vpcs']:
        try:
            delete_vpc_resources(ec2, vpc)
        except Exception as e:
            print(f"Error deleting VPC resources for {vpc['VpcId']}: {str(e)}")

def delete_vpc_resources(ec2, vpc):
    delete_internet_gateways(ec2, vpc)
    delete_subnets(ec2, vpc)
    delete_route_tables(ec2, vpc)
    delete_network_interfaces(ec2, vpc)
    ec2.delete_vpc(VpcId=vpc['VpcId'])

def delete_internet_gateways(ec2, vpc):
    igws = ec2.describe_internet_gateways(
        Filters=[{'Name': 'attachment.vpc-id', 'Values': [vpc['VpcId']]}]
    )
    for igw in igws['InternetGateways']:
        ec2.detach_internet_gateway(InternetGatewayId=igw['InternetGatewayId'], VpcId=vpc['VpcId'])
        ec2.delete_internet_gateway(InternetGatewayId=igw['InternetGatewayId'])

def delete_subnets(ec2, vpc):
    subnets = ec2.describe_subnets(Filters=[{'Name': 'vpc-id', 'Values': [vpc['VpcId']]}])
    for subnet in subnets['Subnets']:
        ec2.delete_subnet(SubnetId=subnet['SubnetId'])

def delete_route_tables(ec2, vpc):
    rts = ec2.describe_route_tables(Filters=[{'Name': 'vpc-id', 'Values': [vpc['VpcId']]}])
    for rt in rts['RouteTables']:
        if not rt['Associations'] or not rt['Associations'][0]['Main']:
            for assoc in rt['Associations']:
                ec2.disassociate_route_table(AssociationId=assoc['RouteTableAssociationId'])
            ec2.delete_route_table(RouteTableId=rt['RouteTableId'])

def delete_network_interfaces(ec2, vpc):
    enis = ec2.describe_network_interfaces(
        Filters=[{'Name': 'vpc-id', 'Values': [vpc['VpcId']]}]
    )
    for eni in enis['NetworkInterfaces']:
        ec2.delete_network_interface(NetworkInterfaceId=eni['NetworkInterfaceId'])

def cleanup_cdk_toolkit_resources(iam, cf, account_id, region):
    try:
        delete_cdk_toolkit_role(iam, account_id, region)
    except Exception as e:
        print(f"Error deleting CDK Toolkit role in {region}: {str(e)}")
    
    try:
        delete_cdk_toolkit_stack(cf)
    except Exception as e:
        print(f"Error deleting CDK Toolkit stack in {region}: {str(e)}")

def delete_cdk_toolkit_role(iam, account_id, region):
    role_name = f'cdk-hnb659fds-cfn-exec-role-{account_id}-{region}'
    role = iam.get_role(RoleName=role_name)
    
    detach_role_policies(iam, role_name)
    delete_role_inline_policies(iam, role_name)
    iam.delete_role(RoleName=role_name)

def detach_role_policies(iam, role_name):
    attached_policies = iam.list_attached_role_policies(RoleName=role_name)
    for policy in attached_policies['AttachedPolicies']:
        iam.detach_role_policy(
            RoleName=role_name,
            PolicyArn=policy['PolicyArn']
        )

def delete_role_inline_policies(iam, role_name):
    inline_policies = iam.list_role_policies(RoleName=role_name)
    for policy_name in inline_policies['PolicyNames']:
        iam.delete_role_policy(
            RoleName=role_name,
            PolicyName=policy_name
        )

def delete_cdk_toolkit_stack(cf):
    cf.delete_stack(StackName='CDKToolkit')
    waiter = cf.get_waiter('stack_delete_complete')
    waiter.wait(StackName='CDKToolkit')
`;
  }
}