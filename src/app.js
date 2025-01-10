const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { Util } = require('./util');
const { logger } = require('./middleware/logging');
const { ErrorHandler } = require('./middleware/error');
const { PassportService } = require('./services');
const { StorageConfig, FileUploader } = require('./middleware/upload');
const InitializationMiddleware = require('./middleware/initialization');
const routes = require('./routes');

class Application {
  constructor() {
    this.app = express();
    this.prisma = new PrismaClient();
    this.app.set('prisma', this.prisma);
    this.errorHandler = new ErrorHandler();
  }

  async initialize() {
    try {
      // 初期化に必要なサービスとコンポーネントの準備
      const storageConfig = new StorageConfig();
      const fileUploader = new FileUploader(storageConfig);
      const passportService = new PassportService(this.prisma, logger);

      // サービスの初期化
      const services = {
        auth: passportService,
        profile: this.prisma,
        micropost: this.prisma,
        system: this.prisma,
        category: this.prisma,
        like: this.prisma,
        comment: this.prisma,
        notification: this.prisma
      };

      // コントローラーの初期化
      const controllers = require('./controllers')(services, this.errorHandler, logger);

      // アプリケーションの初期化
      await InitializationMiddleware.initialize(this.app, {
        routes,
        controllers,
        fileUploader,
        passportService,
        util: Util
      });

      return this.app;
    } catch (error) {
      logger.error('Failed to initialize application:', error);
      throw error;
    }
  }

  async start() {
    try {
      await this.initialize();
      
      const port = process.env.PORT || 8080;
      const host = '0.0.0.0';  // Listen on all interfaces
      
      this.server = this.app.listen(port, host, () => {
        logger.info('Server Information', {
          environment: process.env.NODE_ENV || 'development',
          server: `http://${host}:${port}`,
          host: host,
          port: port
        });
      });

      // Enable keep-alive
      this.server.keepAliveTimeout = 65000;
      this.server.headersTimeout = 66000;
    } catch (error) {
      logger.error('Failed to start server:', error);
      throw error;
    }
  }

  async cleanup() {
    if (this.prisma) {
      await this.prisma.$disconnect();
    }
    if (this.server) {
      await new Promise((resolve) => {
        this.server.close(resolve);
      });
    }
  }
}

// アプリケーションのインスタンス作成と起動
const app = new Application();

// 開発環境でない場合は自動起動
if (process.env.NODE_ENV !== 'test') {
  app.start().catch(err => {
    logger.error('Failed to start application:', err);
    process.exit(1);
  });
}

// プロセスシグナルのハンドリング
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, cleaning up...');
  await app.cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, cleaning up...');
  await app.cleanup();
  process.exit(0);
});

// テスト環境用にアプリケーションインスタンスをエクスポート
module.exports = app;