// notify.js

const https = require('https');

exports.handler = async (event) => {
  const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
  const stackName = process.env.STACK_NAME;

  if (!SLACK_WEBHOOK_URL) {
    throw new Error('SLACK_WEBHOOK_URL environment variable is not set');
  }

  const message = {
    text: `🎉 Stack deployment successful!\nStack: ${stackName}\nTimestamp: ${new Date().toISOString()}`,
  };

  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(SLACK_WEBHOOK_URL, options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve({
            statusCode: 200,
            body: 'Message sent to Slack successfully',
          });
        } else {
          reject(new Error(`Failed to send message to Slack: ${res.statusCode} ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(JSON.stringify(message));
    req.end();
  });
};