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

    const listFailedStacksFunction = new lambda.Function(this, 'ListFailedStacksFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        const AWS = require('aws-sdk');
        
        exports.handler = async function(event) {
          const regions = ['ap-northeast-1', 'us-east-1'];
          const failedStacks = [];
          
          for (const region of regions) {
            const cfn = new AWS.CloudFormation({ region });
            
            try {
              // 失敗状態のスタック一覧を取得
              const listResult = await cfn.listStacks({
                StackStatusFilter: [
                  'CREATE_FAILED',
                  'ROLLBACK_FAILED',
                  'DELETE_FAILED',
                  'UPDATE_ROLLBACK_FAILED',
                  'ROLLBACK_IN_PROGRESS',
                  'ROLLBACK_COMPLETE'
                ]
              }).promise();
              
              // 各スタックの詳細情報を取得
              for (const stack of listResult.StackSummaries) {
                const detail = await cfn.describeStacks({
                  StackName: stack.StackName
                }).promise();
                
                failedStacks.push({
                  region: region,
                  stackName: stack.StackName,
                  status: stack.StackStatus,
                  statusReason: stack.StackStatusReason || 'No reason provided',
                  creationTime: stack.CreationTime,
                  lastUpdatedTime: stack.LastUpdatedTime
                });
              }
              
            } catch (err) {
              console.error(\`リージョン \${region} でエラー発生:\`, err);
            }
          }
          
          // 結果を整形して出力
          console.log('=== 失敗したスタックの一覧 ===');
          failedStacks.forEach(stack => {
            console.log(\`
リージョン: \${stack.region}
スタック名: \${stack.stackName}
状態: \${stack.status}
失敗理由: \${stack.statusReason}
作成時刻: \${stack.creationTime}
最終更新: \${stack.lastUpdatedTime || 'N/A'}
-------------------\`);
          });
          
          if (failedStacks.length === 0) {
            console.log('失敗したスタックは見つかりませんでした。');
          }
          
          return { PhysicalResourceId: Date.now().toString() };
        }
      `),
      timeout: cdk.Duration.minutes(5),
      memorySize: 256
    });

    // 必要な権限を付与
    listFailedStacksFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'cloudformation:ListStacks',
        'cloudformation:DescribeStacks'
      ],
      resources: ['*']
    }));

    // カスタムリソースとして実行
    new custom.Provider(this, 'ListFailedStacksProvider', {
      onEventHandler: listFailedStacksFunction
    });
  }
}