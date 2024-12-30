// index.js
'use strict';

// 依存関係のインポート
const axios = require('axios');

// Webhook URLの設定
const WEBHOOK_URL = 'https://hooks.slack.com/services/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';

// Lambda handler関数
async function slackNotification(event, context) {
    console.log('Lambda function started');
    
    try {
        const response = await axios.post(WEBHOOK_URL, {
            text: 'テスト通知です！'
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
    handler: slackNotification
};