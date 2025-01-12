// index.js
'use strict';

// 依存関係のインポート
const axios = require('axios');

// Lambda handler関数
async function slack-notification(event, context) {
    console.log('Lambda function started');
    console.log('Event:', JSON.stringify(event));

    // イベントからWebhook URLを取得
    const webhookUrl = event.webhookUrl;
    const message = event.message || 'テスト通知です！';
    const channelMention = '<!channel> ';  // @channelメンション用のプレフィックス

    if (!webhookUrl) {
        return {
            statusCode: 400,
            body: JSON.stringify({
                message: 'Webhook URLが指定されていません',
            })
        };
    }
    
    try {
        const response = await axios.post(webhookUrl, {
            text: channelMention + message  // メッセージの前に@channelメンションを追加
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: '通知送信成功',
                slackResponse: response.data
            })
        };
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
}

// handlerのエクスポート
module.exports = {
    handler: slack-notification
};