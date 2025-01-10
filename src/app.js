// External Libraries
const express = require('express');

// Database
const { PrismaClient } = require('@prisma/client');

// Internal Utilities
const { Util } = require('./util');

// Middleware
const { logger } = require('./middleware/core/logging');
const { ErrorHandler } = require('./middleware/core/error');
const { StorageConfig, FileUploader } = require('./middleware/upload');
const InitializationMiddleware = require('./middleware/initialization');

// Services
const { PassportService, MicropostService, ProfileService } = require('./services');

// Routes
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
      const micropostService = new MicropostService(this.prisma, logger);
      const profileService = new ProfileService(this.prisma, logger);

      // サステムサービスの初期化
      const systemService = {
        getHealth: async () => {
          return {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development'
          };
        },
        getDbHealth: async () => {
          try {
            await this.prisma.$queryRaw`SELECT 1`;
            return {
              status: 'healthy',
              timestamp: new Date().toISOString()
            };
          } catch (error) {
            return {
              status: 'unhealthy',
              error: error.message,
              timestamp: new Date().toISOString()
            };
          }
        }
      };

      // Prismaサービスの初期化
      const prismaService = {
        ...this.prisma,
        user: this.prisma.user,
        micropost: this.prisma.micropost,
        category: this.prisma.category,
        like: this.prisma.like,
        comment: this.prisma.comment,
        notification: this.prisma.notification,
        follow: this.prisma.follow
      };

      // サービスの初期化
      const services = {
        auth: passportService,
        profile: profileService,
        micropost: micropostService,
        system: systemService,
        category: prismaService,
        like: prismaService,
        comment: prismaService,
        notification: prismaService,
        follow: prismaService
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