const express = require('express');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

// Internal dependencies
const { logger } = require('./middleware/logging');
const { Util, StorageConfig, FileUploader } = require('./util');
const {
  ErrorHandler,
  handleCSRFError,
  handle404Error,
  handle500Error
} = require('./middleware/error');

const setupRoutes = require('./routes');
const {
  setupBasic,
  setupAuthMiddleware,
} = require('./middleware');
const { middleware: loggingMiddleware } = require('./middleware/logging');
const { setupSecurity } = require('./middleware/security');

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
  DevController,
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
    host: process.env.APP_HOST || '0.0.0.0',
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
    this.errorHandler = new ErrorHandler(this.storageConfig.getUploadLimits());
    this.instanceType = null;
  }

  // Initialization Methods
  initializeCore() {
    const passportService = new PassportService(this.prisma, logger);
    passportService.configurePassport();
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

  // Middleware Setup Methods
  setupMiddleware() {
    setupBasic(this.app);
    setupAuthMiddleware(this.app, CONFIG);
    this.app.use(loggingMiddleware.request);
    setupSecurity(this.app);
    this.app.use(handleCSRFError(this.errorHandler));
  }

  setupRoutes() {
    setupRoutes(this.app, this.controllers, this.fileUploader);
  }

  setupErrorHandler() {
    this.app.use(handle404Error);
    this.app.use(handle500Error);
  }

  // Application Lifecycle Methods
  async start() {
    try {
      await this.initializeApplication();
      await this.startServer();
      return this.server;
    } catch (error) {
      logger.error('Failed to start application:', error);
      throw error;
    }
  }

  async initializeApplication() {
    await this.detectInstanceType();
    this.fileUploader.setupDirectories();
    this.initializeCore();
    this.services = this.initializeServices();
    this.controllers = this.initializeControllers();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandler();
    this.configureStorageType();
  }

  async detectInstanceType() {
    try {
      this.instanceType = await Util.checkInstanceType();
      logger.info(`Starting application on ${this.instanceType}`);
    } catch (instanceTypeError) {
      logger.warn('Failed to determine instance type, defaulting to Lightsail/Other:', instanceTypeError);
      this.instanceType = 'Lightsail/Other';
    }
  }

  configureStorageType() {
    if (this.instanceType === 'Lightsail/Other') {
      logger.info('Running on Lightsail - using local storage configuration');
      process.env.USE_S3 = 'false';
    } else {
      logger.info('Running on EC2 - using S3 storage configuration');
      process.env.USE_S3 = 'true';
    }
  }

  async startServer() {
    const port = CONFIG.app.port;
    const host = CONFIG.app.host;
    
    this.server = this.app.listen(port, host, () => {
      this.logServerStartup();
    });
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