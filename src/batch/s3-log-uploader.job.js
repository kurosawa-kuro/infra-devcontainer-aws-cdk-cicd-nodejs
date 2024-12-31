const cron = require('node-cron');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

class LogUploader {
  constructor() {
    this.logger = this.setupLogger();
    this.s3Client = new S3Client({
      region: process.env.STORAGE_S3_REGION || 'ap-northeast-1',
      credentials: {
        accessKeyId: process.env.STORAGE_S3_ACCESS_KEY,
        secretAccessKey: process.env.STORAGE_S3_SECRET_KEY
      }
    });
    this.bucketName = process.env.STORAGE_S3_BUCKET;
    this.logDir = path.join(__dirname, '../../logs');
  }

  setupLogger() {
    return winston.createLogger({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        }),
        new winston.transports.File({
          filename: path.join(__dirname, '../../logs/batch-log-uploader.log')
        })
      ]
    });
  }

  async uploadFile(localPath, s3Key) {
    try {
      const fileContent = await fs.readFile(localPath);
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
        Body: fileContent,
        ContentType: 'text/plain'
      });

      await this.s3Client.send(command);
      this.logger.info(`Successfully uploaded ${localPath} to s3://${this.bucketName}/${s3Key}`);
    } catch (error) {
      this.logger.error(`Failed to upload ${localPath}: ${error.message}`);
      throw error;
    }
  }

  async rotateFile(filePath) {
    const timestamp = new Date().toISOString().slice(0, 10);
    const rotatedPath = `${filePath}.${timestamp}`;
    try {
      await fs.rename(filePath, rotatedPath);
      await fs.writeFile(filePath, ''); // 新しい空のログファイルを作成
      this.logger.info(`Rotated ${filePath} to ${rotatedPath}`);
      return rotatedPath;
    } catch (error) {
      this.logger.error(`Failed to rotate ${filePath}: ${error.message}`);
      throw error;
    }
  }

  async processLogFile(filename) {
    const localPath = path.join(this.logDir, filename);
    const timestamp = new Date().toISOString().slice(0, 10);
    const s3Key = `logs/${timestamp}/${filename}`;

    try {
      // ファイルが存在し、サイズが0より大きい場合のみ処理
      const stats = await fs.stat(localPath);
      if (stats.size > 0) {
        await this.uploadFile(localPath, s3Key);
        const rotatedPath = await this.rotateFile(localPath);
        // 一週間以上前のローテーションファイルを削除
        await this.cleanupOldLogs(filename);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') { // ファイルが存在しない場合は無視
        this.logger.error(`Error processing ${filename}: ${error.message}`);
      }
    }
  }

  async cleanupOldLogs(baseFilename) {
    try {
      const files = await fs.readdir(this.logDir);
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

      for (const file of files) {
        if (file.startsWith(baseFilename + '.')) {
          const filePath = path.join(this.logDir, file);
          const dateStr = file.split('.').pop();
          const fileDate = new Date(dateStr);

          if (fileDate < oneWeekAgo) {
            await fs.unlink(filePath);
            this.logger.info(`Deleted old log file: ${file}`);
          }
        }
      }
    } catch (error) {
      this.logger.error(`Error cleaning up old logs: ${error.message}`);
    }
  }

  async uploadLogs() {
    try {
      const logFiles = ['error.log', 'combined.log', 'batch-log-uploader.log'];
      for (const filename of logFiles) {
        await this.processLogFile(filename);
      }
    } catch (error) {
      this.logger.error(`Error in uploadLogs: ${error.message}`);
    }
  }

  async executeNow() {
    this.logger.info('Starting immediate log upload');
    await this.uploadLogs();
    this.logger.info('Completed immediate log upload');
  }

  startScheduler() {
    // 即時実行オプションのチェック
    if (process.argv.includes('--now')) {
      this.executeNow()
        .then(() => process.exit(0))
        .catch(error => {
          this.logger.error('Failed to execute batch:', error);
          process.exit(1);
        });
      return;
    }

    // 通常のスケジューラー処理
    cron.schedule('0 0 * * *', async () => {
      this.logger.info('Starting scheduled log upload');
      await this.uploadLogs();
      this.logger.info('Completed scheduled log upload');
    });

    // プロセス終了時のクリーンアップ
    process.on('SIGINT', async () => {
      this.logger.info('Received SIGINT. Performing final log upload...');
      await this.uploadLogs();
      process.exit(0);
    });

    this.logger.info('Log uploader scheduler started');
  }
}

// バッチを実行
if (require.main === module) {
  const uploader = new LogUploader();
  uploader.startScheduler();
}

module.exports = LogUploader; 