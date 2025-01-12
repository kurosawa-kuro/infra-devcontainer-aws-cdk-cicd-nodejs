import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const client = new LambdaClient({ region: process.env.AWS_REGION });

export const handler = async (event: any) => {
  try {
    // デプロイエラーをシミュレート
    throw new Error('Intentional deployment error for testing');
  } catch (error) {
    const payload = {
      webhookUrl: process.env.SLACK_WEBHOOK_URL,
      message: {
        text: `CDK Deployment Error in ${event.ResourceProperties.stackName}`,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: '🚨 CDK Deployment Failed',
              emoji: true
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Error Details:*\n\`\`\`${error}\`\`\``
            }
          }
        ]
      }
    };

    const command = new InvokeCommand({
      FunctionName: process.env.LAMBDA_FUNCTION_NAME!,
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify(payload))
    });

    await client.send(command);
    throw error; // エラーを再スローしてデプロイを失敗させる
  }
}; 