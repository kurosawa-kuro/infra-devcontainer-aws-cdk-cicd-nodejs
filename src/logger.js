const winston = require('winston');
const WinstonCloudWatch = require('winston-cloudwatch');

const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    // ローカルのコンソール出力用
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple(),
        winston.format.printf(({ level, message, timestamp }) => {
          return `${timestamp} ${level}: ${message}`;
        })
      )
    }),
    // CloudWatch Logs用
    new WinstonCloudWatch({
      logGroupName: '/aws/express/myapp',
      logStreamName: `express-${new Date().toISOString().slice(0, 10)}`,
      awsRegion: 'ap-northeast-1',
      awsOptions: {
        credentials: {
          accessKeyId: process.env.STORAGE_S3_ACCESS_KEY,
          secretAccessKey: process.env.STORAGE_S3_SECRET_KEY
        }
      }
    })
  ]
});

module.exports = logger; 