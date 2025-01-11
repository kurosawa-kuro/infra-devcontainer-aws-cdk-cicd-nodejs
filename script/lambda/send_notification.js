const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const dotenv = require('dotenv');
const path = require('path');

// 環境変数の読み込み
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// エラーメッセージを整形するヘルパー関数
function formatErrorMessage(error) {
    return {
        text: "CDK Deployment Error",
        blocks: [
            {
                type: "header",
                text: {
                    type: "plain_text",
                    text: "🚨 CDK Deployment Failed",
                    emoji: true
                }
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*Error Details:*\n\`\`\`${error}\`\`\``
                }
            },
            {
                type: "context",
                elements: [
                    {
                        type: "mrkdwn",
                        text: `*Time:* ${new Date().toISOString()}`
                    }
                ]
            }
        ]
    };
}

// AWS設定
const client = new LambdaClient({
    region: process.env.AWS_REGION || 'ap-northeast-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

async function invokeLambda(message) {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) {
        throw new Error('SLACK_WEBHOOK_URL environment variable is not set');
    }

    let payload;
    if (typeof message === 'string') {
        payload = {
            webhookUrl: webhookUrl,
            message: message
        };
    } else {
        payload = {
            webhookUrl: webhookUrl,
            ...message
        };
    }

    const command = new InvokeCommand({
        FunctionName: process.env.LAMBDA_FUNCTION_NAME || 'slack-notification',
        InvocationType: 'RequestResponse',
        Payload: Buffer.from(JSON.stringify(payload))
    });

    try {
        const response = await client.send(command);
        console.log('Lambda Response:', JSON.parse(Buffer.from(response.Payload)));
        return response;
    } catch (error) {
        console.error('Error invoking Lambda:', error);
        throw error;
    }
}

// コマンドライン引数からメッセージを取得
const message = process.argv[2];
const isError = process.argv[3] === '--error';

if (!message) {
    console.error('使用方法: node send_notification.js <MESSAGE> [--error]');
    process.exit(1);
}

// Lambda関数の呼び出し
const payload = isError ? formatErrorMessage(message) : message;

invokeLambda(payload)
    .then(() => console.log('通知処理が完了しました'))
    .catch(error => {
        console.error('エラーが発生しました:', error);
        process.exit(1);
    });
