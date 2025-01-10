const express = require('express');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

// Internal dependencies
const {
  logger,
  ErrorHandler,
  handleNotFound,
  handleError,
  setupSecurity,
  setupApplication,
  setupDirectories,
  detectInstanceType,
  configureStorageType
} = require('./middleware');

const { Util, StorageConfig, FileUploader } = require('./util');
const setupRoutes = require('./routes');

// Services
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

// Controllers
const {
  AuthController,
  ProfileController,
  MicropostController,
  SystemController,
  DevelopmentToolsController,
  AdminController,
  CategoryController,
  LikeController,
  CommentController,
  NotificationController
} = require('./controllers');

// Application Configuration
const CONFIG = {
  app: {
    port: process.env.APP_PORT || 8080,
    host: process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost',
    env: process.env.APP_ENV || 'development',
    isProduction: process.env.NODE_ENV === 'production',
    isTest: process.env.APP_ENV === 'test'
  }
};

/**
 * メインのアプリケーションクラス
 * アプリケーションの初期化と実行を管理
 */
class Application {
  constructor() {
    this.app = express();
    this.prisma = new PrismaClient();
    this.storageConfig = new StorageConfig();
    this.fileUploader = new FileUploader(this.storageConfig);
    this.errorHandler = new ErrorHandler();
    this.instanceType = null;
  }

  // Initialization Methods
  async initializeCore() {
    const passportService = new PassportService(this.prisma, logger);
    
    // セキュリティ設定を適用
    setupSecurity(this.app);
    
    // アプリケーションのセットアップ（ルーティングを含む）
    await setupApplication(
      this.app,
      setupRoutes,
      {
        passport: passportService,
        ...this.controllers  // 全てのコントローラーを渡す
      },
      this.fileUploader
    );
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
      development: new DevelopmentToolsController(
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

  setupErrorHandler() {
    console.log('\n=== Error Handler Setup ===');
    console.log('1. Setting up 404 handler');
    this.app.use(handleNotFound);
    
    console.log('2. Setting up error handler');
    this.app.use((err, req, res, next) => {
      console.log('\n=== Error Caught ===');
      console.log('Error:', {
        name: err.name,
        message: err.message,
        stack: err.stack
      });
      handleError(err, req, res, next);
    });
    
    console.log('=== Error Handler Setup Complete ===\n');
  }

  // Application Lifecycle Methods
  async start() {
    try {
      await this.initializeApplication();
      
      const port = process.env.PORT || 8080;
      const host = '0.0.0.0';  // Listen on all interfaces
      
      this.server = this.app.listen(port, host, () => {
        logger.info('Starting application on Lightsail/Other');
        logger.info('Running on Lightsail - using local storage configuration');
        logger.info('Server Information', {
          environment: process.env.NODE_ENV || 'development',
          storage: 'Local',
          server: `http://${host}:${port}`,
          host: host,
          port: port
        });
      });

      // Enable keep-alive
      this.server.keepAliveTimeout = 65000;
      this.server.headersTimeout = 66000;
    } catch (error) {
      logger.error('Failed to start server', { error: error.message });
      throw error;
    }
  }

  async initializeApplication() {
    console.log('\n=== Application Initialization Start ===');

    this.instanceType = await detectInstanceType(Util);
    await setupDirectories(this.fileUploader);
    
    // サービスとコントローラーを先に初期化
    this.services = this.initializeServices();
    this.controllers = this.initializeControllers();
    
    // セキュリティとアプリケーションのセットアップ
    await this.initializeCore();
    
    // エラーハンドラーとストレージの設定
    this.setupErrorHandler();
    configureStorageType(this.instanceType);

    console.log('=== Application Initialization Complete ===\n');
  }

  async cleanup() {
    await this.prisma.$disconnect();
  }
}

// Application Instance and Process Handlers
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