const { FirehoseClient, PutRecordCommand } = require('@aws-sdk/client-firehose');
const dotenv = require('dotenv');
const path = require('path');

// 環境変数の読み込み
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// 環境変数のマッピング
process.env.AWS_ACCESS_KEY_ID = process.env._AWS_ACCESS_KEY_ID;
process.env.AWS_SECRET_ACCESS_KEY = process.env._AWS_SECRET_ACCESS_KEY;
process.env.AWS_REGION = process.env._AWS_REGION;

// Firehoseクライアントの設定
const client = new FirehoseClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  },
  // エンドポイント解決を明示的に指定
  endpointResolver: (region) => ({
    url: new URL(`https://firehose.${region}.amazonaws.com`)
  })
});

// ログ送信関数
async function sendLogToFirehose(message) {
  const params = {
    DeliveryStreamName: 'cdkjavascript01-stream',
    Record: {
      Data: Buffer.from(JSON.stringify(message))
    }
  };

  try {
    const command = new PutRecordCommand(params);
    const response = await client.send(command);
    console.log('ログ送信成功:', response);
    return response;
  } catch (error) {
    console.error('ログ送信エラー:', error);
    throw error;
  }
}

// メイン処理
(async () => {
  try {
    let logData;
    if (process.argv[2]) {
      try {
        logData = JSON.parse(process.argv[2]);
      } catch (parseError) {
        throw new Error('Invalid JSON format in argument');
      }
    } else {
      logData = {
        msg: 'ok',
        timestamp: new Date().toISOString(),
        source: 'ec2-instance'
      };
    }

    // Firehoseにログを送信
    await sendLogToFirehose(logData);
    console.log('ログ送信処理が完了しました');
  } catch (error) {
    console.error('エラーが発生しました:', error.message);
    process.exit(1);
  }
})();
