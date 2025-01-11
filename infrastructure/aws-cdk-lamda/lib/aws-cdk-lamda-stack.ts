import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

interface AwsCdkLamdaStackProps extends cdk.StackProps {
  functionName: string;
}

export class AwsCdkLamdaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AwsCdkLamdaStackProps) {
    super(scope, id, props);

    // Create Lambda execution role
    const lambdaRole = new iam.Role(this, 'SlackNotificationLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Create Lambda function
    const slackNotificationFunction = new lambda.Function(this, 'SlackNotificationFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../src/slack-notification')),
      role: lambdaRole,
      functionName: props.functionName,
      timeout: cdk.Duration.seconds(30),
      memorySize: 128
    });
  }
}
