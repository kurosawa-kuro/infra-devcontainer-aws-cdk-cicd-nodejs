import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as iam from 'aws-cdk-lib/aws-iam';

interface SlackNotificationStackProps extends cdk.StackProps {
  notificationTopicArn: string;
}

export class SlackNotificationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SlackNotificationStackProps) {
    super(scope, id, {
      ...props,
      env: { region: 'ap-northeast-1' },
    });

    const notificationTopic = sns.Topic.fromTopicArn(
      this,
      'ImportedNotificationTopic',
      props.notificationTopicArn
    );

    const slackNotificationFunction = new lambda.Function(this, 'SlackNotificationFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        const https = require('https');
        
        exports.handler = async (event) => {
          try {
            console.log('Event:', JSON.stringify(event, null, 2));
            
            // SNSメッセージの取得と検証
            if (!event.Records || !event.Records[0] || !event.Records[0].Sns || !event.Records[0].Sns.Message) {
              throw new Error('Invalid SNS event structure');
            }
            
            let message;
            try {
              message = JSON.parse(event.Records[0].Sns.Message);
              console.log('Parsed message:', JSON.stringify(message, null, 2));
            } catch (parseError) {
              console.error('Failed to parse SNS message:', parseError);
              throw new Error('Invalid message format');
            }
            
            // メッセージの必須フィールドを検証
            const requiredFields = ['stackName', 'region', 'albEndpoint', 'cloudFrontEndpoint', 'ec2PublicIp'];
            for (const field of requiredFields) {
              if (!message[field]) {
                console.error(\`Missing required field: \${field}\`);
                throw new Error(\`Missing required field: \${field}\`);
              }
            }
            
            const blocks = [
              {
                type: "header",
                text: {
                  type: "plain_text",
                  text: "🎉 Deployment Complete!",
                  emoji: true
                }
              },
              {
                type: "section",
                fields: [
                  {
                    type: "mrkdwn",
                    text: "*Stack:*\\n" + message.stackName
                  },
                  {
                    type: "mrkdwn",
                    text: "*Region:*\\n" + message.region
                  }
                ]
              },
              {
                type: "section",
                fields: [
                  {
                    type: "mrkdwn",
                    text: "*ALB Endpoint:*\\n" + message.albEndpoint
                  },
                  {
                    type: "mrkdwn",
                    text: "*CloudFront Endpoint:*\\n" + message.cloudFrontEndpoint
                  }
                ]
              },
              {
                type: "section",
                fields: [
                  {
                    type: "mrkdwn",
                    text: "*EC2 Instance IP:*\\n" + message.ec2PublicIp
                  }
                ]
              }
            ];

            const payload = {
              channel: "C086SMP8YSY",
              blocks: blocks
            };

            // Slack Incoming Webhook設定
            const options = {
              hostname: "tk-qu31607.slack.com",
              path: "/api/chat.postMessage",
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(JSON.stringify(payload)),
                "Authorization": "Bearer xoxb-"
              }
            };

            return new Promise((resolve, reject) => {
              const req = https.request(options, (res) => {
                let responseBody = "";
                res.on("data", (chunk) => {
                  responseBody += chunk;
                });
                
                res.on("end", () => {
                  console.log("Slack API Response Status:", res.statusCode);
                  console.log("Slack API Response Body:", responseBody);
                  
                  if (res.statusCode === 200) {
                    resolve({
                      statusCode: 200,
                      body: "Message sent to Slack successfully"
                    });
                  } else {
                    console.error("Failed to send to Slack. Status:", res.statusCode);
                    console.error("Response Body:", responseBody);
                    reject(new Error(\`Failed to send message to Slack. Status: \${res.statusCode}\`));
                  }
                });
              });

              req.on("error", (error) => {
                console.error("Error sending to Slack:", error);
                reject(error);
              });

              const stringifiedPayload = JSON.stringify(payload);
              console.log("Sending payload to Slack:", stringifiedPayload);
              req.write(stringifiedPayload);
              req.end();
            });
          } catch (error) {
            console.error('Error in Lambda function:', error);
            throw error;
          }
        };
      `),
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
      description: 'Lambda function to send Slack notifications',
    });

    notificationTopic.addSubscription(
      new subscriptions.LambdaSubscription(slackNotificationFunction)
    );

    // Add CloudWatch Logs permissions
    slackNotificationFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents'
        ],
        resources: ['*']
      })
    );
  }
} 