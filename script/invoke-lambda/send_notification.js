const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const dotenv = require('dotenv');
const path = require('path');

// 環境変数の読み込み
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

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

    const command = new InvokeCommand({
        FunctionName: process.env.LAMBDA_FUNCTION_NAME || 'slackNotification',
        InvocationType: 'RequestResponse',
        Payload: Buffer.from(JSON.stringify({
            webhookUrl: webhookUrl,
            message: message
        }))
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

if (!message) {
    console.error('使用方法: node send_notification.js <MESSAGE>');
    process.exit(1);
}

// Lambda関数の呼び出し
invokeLambda(message)
    .then(() => console.log('通知処理が完了しました'))
    .catch(error => {
        console.error('エラーが発生しました:', error);
        process.exit(1);
    });
