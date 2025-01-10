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
const { PassportService, MicropostService, ProfileService, CommentService, AuthService, LikeService, NotificationService } = require('./services');

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
      const authService = new AuthService(this.prisma, logger);
      const passportService = new PassportService(this.prisma, logger);
      const micropostService = new MicropostService(this.prisma, logger);
      const profileService = new ProfileService(this.prisma, logger);
      const commentService = new CommentService(this.prisma, logger);
      const likeService = new LikeService(this.prisma, logger);
      const notificationService = new NotificationService(this.prisma, logger);

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
        auth: authService,
        passport: passportService,
        profile: profileService,
        micropost: micropostService,
        system: systemService,
        category: prismaService,
        like: likeService,
        comment: commentService,
        notification: notificationService,
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
      logger.error('Application initialization failed:', error);
      throw error;
    }
  }
}

module.exports = Application;

// Server startup code
if (require.main === module) {
  const PORT = process.env.PORT || 8080;
  const app = new Application();
  
  (async () => {
    try {
      const expressApp = await app.initialize();
      if (process.env.NODE_ENV !== 'test') {
        expressApp.listen(PORT, () => {
          console.log(`Server is running on port ${PORT}`);
        });
      }
    } catch (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
  })();
}