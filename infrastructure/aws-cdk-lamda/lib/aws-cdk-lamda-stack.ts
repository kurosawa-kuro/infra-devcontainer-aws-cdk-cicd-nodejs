import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

interface AwsCdkLamdaStackProps extends cdk.StackProps {
  functionName: string;
}

export class AwsCdkLamdaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AwsCdkLamdaStackProps) {
    super(scope, id, props);

    // Create Lambda execution role
    const lambdaRole = new iam.Role(this, 'TestNodejsLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Create Lambda function
    const testNodejsFunction = new lambda.Function(this, 'TestNodejsFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Hello from test_nodejs Lambda!' }),
          };
        };
      `),
      role: lambdaRole,
      functionName: props.functionName,
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
    });
  }
}
