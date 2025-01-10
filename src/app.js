const express = require('express');
const path = require('path');
const multer = require('multer');
const { PrismaClient } = require('@prisma/client');
const { S3Client } = require('@aws-sdk/client-s3');
const multerS3 = require('multer-s3');
const fs = require('fs');
require('dotenv').config();
const passport = require('passport');
const logger = require('./logger');
const { Util, StorageConfig, FileUploader } = require('./util');
const { ErrorHandler, handleCSRFError, handle404Error, handle500Error } = require('./error');

const setupRoutes = require('./routes');
const {
  setupBasicMiddleware,
  setupAuthMiddleware,
  setupRequestLogging,
  setupErrorLogging,
  setupSecurity,
} = require('./middleware');
const {
  AuthService,
  ProfileService,
  MicropostService,
  SystemService,
  CategoryService,
  PassportService,
  LikeService,
  CommentService,
  NotificationService,
  FollowService
} = require('./services');
const {
  AuthController,
  ProfileController,
  MicropostController,
  SystemController,
  DevController,
  AdminController,
  CategoryController,
  LikeController,
  CommentController,
  NotificationController
} = require('./controllers');

// Constants and Configuration
const CONFIG = {
  app: {
    port: process.env.APP_PORT || 8080,
    host: process.env.APP_HOST || '0.0.0.0',
    env: process.env.APP_ENV || 'development',
    isProduction: process.env.NODE_ENV === 'production',
    isTest: process.env.APP_ENV === 'test'
  }
};

// メインのアプリケーションクラス
class Application {
  constructor() {
    this.app = express();
    this.prisma = new PrismaClient();
    this.storageConfig = new StorageConfig();
    this.fileUploader = new FileUploader(this.storageConfig);
    this.errorHandler = new ErrorHandler(this.storageConfig.getUploadLimits());
    this.instanceType = null;
  }

  setupDirectories() {
    const dirs = [
      path.join(__dirname, 'public'),
      path.join(__dirname, 'public', 'uploads'),
      path.join(__dirname, 'public', 'css')
    ];

    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.chmodSync(dir, '755');
    });
  }

  initializeCore() {
    const passportService = new PassportService(this.prisma, logger);
    passportService.configurePassport(passport);
  }

  initializeServices() {
    return {
      auth: new AuthService(this.prisma, logger),
      profile: new ProfileService(this.prisma, logger),
      micropost: new MicropostService(this.prisma, logger),
      system: new SystemService(this.prisma, logger),
      category: new CategoryService(this.prisma, logger),
      passport: new PassportService(this.prisma, logger),
      like: new LikeService(this.prisma, logger),
      comment: new CommentService(this.prisma, logger),
      notification: new NotificationService(this.prisma, logger),
      follow: new FollowService(this.prisma, logger)
    };
  }

  initializeControllers() {
    return {
      auth: new AuthController(this.services.auth, this.errorHandler, logger),
      profile: new ProfileController(
        { 
          profile: this.services.profile,
          micropost: this.services.micropost,
          follow: this.services.follow
        },
        this.errorHandler,
        logger
      ),
      micropost: new MicropostController(
        { 
          micropost: this.services.micropost, 
          like: this.services.like,
          comment: this.services.comment 
        },
        this.fileUploader,
        this.errorHandler,
        logger
      ),
      system: new SystemController(this.services.system, this.errorHandler, logger),
      dev: new DevController(
        { 
          system: this.services.system,
          profile: this.services.profile,
          micropost: this.services.micropost
        },
        this.errorHandler,
        logger
      ),
      admin: new AdminController(this.services, this.errorHandler, logger),
      category: new CategoryController(this.services.category, this.errorHandler, logger),
      like: new LikeController(this.services.like, this.errorHandler, logger),
      comment: new CommentController(this.services, this.errorHandler, logger),
      notification: new NotificationController(this.services, this.errorHandler, logger)
    };
  }

  setupMiddleware() {
    setupBasicMiddleware(this.app);
    setupAuthMiddleware(this.app, CONFIG);
    setupRequestLogging(this.app, logger);
    setupErrorLogging(this.app, logger);
    this.app.use(handleCSRFError(this.errorHandler));
  }

  setupRoutes() {
    setupRoutes(this.app, this.controllers, this.fileUploader);
  }

  setupErrorHandler() {
    this.app.use(handle404Error);
    this.app.use(handle500Error);
  }

  async start() {
    try {
      // インスタンスタイプの確認（エラーハンドリングを強化）
      try {
        this.instanceType = await Util.checkInstanceType();
        logger.info(`Starting application on ${this.instanceType}`);
      } catch (instanceTypeError) {
        logger.warn('Failed to determine instance type, defaulting to Lightsail/Other:', instanceTypeError);
        this.instanceType = 'Lightsail/Other';
      }

      // 各種初期化処理
      this.setupDirectories();
      this.initializeCore();
      this.services = this.initializeServices();
      this.controllers = this.initializeControllers();
      this.setupMiddleware();
      this.setupRoutes();
      this.setupErrorHandler();

      // インスタンスタイプに応じた設定
      if (this.instanceType === 'Lightsail/Other') {
        logger.info('Running on Lightsail - using local storage configuration');
        process.env.USE_S3 = 'false';
      } else {
        logger.info('Running on EC2 - using S3 storage configuration');
        process.env.USE_S3 = 'true';
      }

      // サーバー起動
      const port = CONFIG.app.port;
      const host = CONFIG.app.host;
      
      this.server = this.app.listen(port, host, () => {
        this.logServerStartup();
      });

      return this.server;
    } catch (error) {
      logger.error('Failed to start application:', error);
      throw error;
    }
  }

  logServerStartup() {
    logger.info('Server Information', {
      environment: CONFIG.app.env,
      storage: this.storageConfig.isEnabled() ? 'S3' : 'Local',
      server: `http://${CONFIG.app.host}:${CONFIG.app.port}`
    });
  }

  async cleanup() {
    await this.prisma.$disconnect();
  }
}

const app = new Application();
app.start().catch(err => {
  logger.error('Failed to start application:', { error: err });
  process.exit(1);
});

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

module.exports = { Application };