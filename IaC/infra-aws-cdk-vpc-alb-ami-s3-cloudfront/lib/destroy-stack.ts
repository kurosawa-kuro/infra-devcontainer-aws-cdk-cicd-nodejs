import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as custom from 'aws-cdk-lib/custom-resources';
import * as lambda from 'aws-cdk-lib/aws-lambda';
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

type StackStatus = typeof STACK_STATUS_PATTERNS.FAILED_STATES[number];

interface DestroyStackProps extends cdk.StackProps {
  prefix?: string;
}

interface StackInfo {
  StackName: string;
  StackStatus: string;
  StackId: string;
}

/**
 * Stack for listing and cleaning up failed CloudFormation stacks
 */
export class DestroyStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: DestroyStackProps) {
    super(scope, id, props);
  }
}