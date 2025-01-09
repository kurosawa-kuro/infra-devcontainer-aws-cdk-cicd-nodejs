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
      code: lambda.Code.fromInline(`
        const https = require('https');
        const url = require('url');

        exports.handler = async (event) => {
          try {
            // イベントからWebhook URLとメッセージを取得
            const { webhookUrl, message } = event;
            if (!webhookUrl) {
              throw new Error('webhookUrl is required in the event payload');
            }

            // メッセージの準備
            let payload;
            if (typeof message === 'string') {
              payload = { text: message };
            } else if (message) {
              payload = message;
            } else if (typeof event === 'string') {
              payload = { text: event };
            } else {
              payload = event;
            }

            // Slack Webhook URLをパース
            const webhookParsed = new url.URL(webhookUrl);

            // POSTリクエストのオプション
            const options = {
              hostname: webhookParsed.hostname,
              path: webhookParsed.pathname,
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
            };

            // Slackに通知を送信
            const response = await new Promise((resolve, reject) => {
              const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => resolve({ statusCode: res.statusCode, data }));
              });

              req.on('error', reject);
              req.write(JSON.stringify(payload));
              req.end();
            });

            // レスポンスの確認
            if (response.statusCode === 200) {
              return {
                statusCode: 200,
                body: JSON.stringify({ message: '通知送信成功' })
              };
            } else {
              throw new Error(\`Slack API returned status code: \${response.statusCode}\`);
            }
          } catch (error) {
            console.error('Error:', error);
            return {
              statusCode: 500,
              body: JSON.stringify({
                message: '通知送信失敗',
                error: error.message
              })
            };
          }
        };
      `),
      role: lambdaRole,
      functionName: props.functionName,
      timeout: cdk.Duration.seconds(30),
      memorySize: 128
    });
  }
}
