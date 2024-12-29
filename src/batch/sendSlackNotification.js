// notify.js

const axios = require('axios');

const WEBHOOK_URL = 'https://hooks.slack.com/services/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';

async function sendSlackNotification() {
  try {
    const response = await axios.post(WEBHOOK_URL, {
      text: 'テスト通知です！',
    });

    if (response.status === 200) {
      console.log('通知送信成功');
    } else {
      console.error('通知送信失敗:', response.statusText);
    }
  } catch (error) {
    console.error('エラー発生:', error);
  }
}

sendSlackNotification();