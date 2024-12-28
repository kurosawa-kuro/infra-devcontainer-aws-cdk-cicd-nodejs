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
 * Stack for listing failed CloudFormation stacks
 */
export class DestroyStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DestroyStackProps) {
    // Generate a unique stack name with timestamp
    const timestamp = Math.floor(Date.now() / 1000);
    const uniqueId = `${id}-${timestamp}`;
    super(scope, uniqueId, props);

    // Create a custom resource to list failed stacks
    const listFailedStacks = new custom.AwsCustomResource(this, 'ListFailedStacks', {
      onCreate: {
        service: 'CloudFormation',
        action: 'listStacks',
        parameters: {
          StackStatusFilter: [...STACK_STATUS_PATTERNS.FAILED_STATES]
        },
        physicalResourceId: custom.PhysicalResourceId.of(`ListFailedStacks-${timestamp}`)
      },
      onUpdate: {
        service: 'CloudFormation',
        action: 'listStacks',
        parameters: {
          StackStatusFilter: [...STACK_STATUS_PATTERNS.FAILED_STATES]
        },
        physicalResourceId: custom.PhysicalResourceId.of(`ListFailedStacks-${timestamp}`)
      },
      policy: custom.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'cloudformation:ListStacks',
            'lambda:InvokeFunction'
          ],
          resources: ['*']
        })
      ])
    });

    // Output the failed stacks
    new cdk.CfnOutput(this, 'FailedStacks', {
      value: listFailedStacks.getResponseField('StackSummaries').toString(),
      description: 'List of CloudFormation stacks in failed states'
    });
  }
}
