const express = require('express');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();
const session = require('express-session');
const passport = require('passport');

// Internal dependencies
const { logger } = require('./middleware/logging');
const { Util, StorageConfig, FileUploader } = require('./util');
const {
  ErrorHandler,
  handleNotFound,
  handleError
} = require('./middleware/error');

const setupRoutes = require('./routes');
const {
  setupBasic,
  setupAuthMiddleware,
  setupSession
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

  // Middleware Setup Methods
  setupMiddleware() {
    console.log('\n=== Middleware Setup Start ===');
    
    // 1. Basic middleware setup (body parsers, etc.)
    setupBasic(this.app);
    console.log('1. Basic middleware setup complete');

    // 2. Session setup (before security and auth)
    setupSession(this.app);
    console.log('2. Session setup complete');

    // 3. Passport initialization
    this.app.use(passport.initialize());
    this.app.use(passport.session());
    console.log('3. Passport initialization complete');

    // 4. Security middleware (after session, before routes)
    setupSecurity(this.app);
    console.log('4. Security middleware setup complete');

    // 5. Routes setup
    this.setupRoutes();
    console.log('5. Routes setup complete');

    // 6. Error handlers
    this.setupErrorHandler();
    console.log('6. Error handlers setup complete');
  }

  setupRoutes() {
    console.log('\n=== Routes Setup Start ===');
    console.log('1. Controllers available:', Object.keys(this.controllers));
    console.log('2. Setting up routes with controllers');
    setupRoutes(this.app, this.controllers, this.fileUploader);
    console.log('=== Routes Setup Complete ===\n');
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
    console.log('1. Starting initialization process');

    await this.detectInstanceType();
    console.log('2. Instance type detected:', this.instanceType);

    this.fileUploader.setupDirectories();
    console.log('3. Directories setup complete');

    console.log('4. Initializing core components');
    this.initializeCore();
    console.log('5. Core initialization complete');

    console.log('6. Initializing services');
    this.services = this.initializeServices();
    console.log('7. Services initialized:', Object.keys(this.services));

    console.log('8. Initializing controllers');
    this.controllers = this.initializeControllers();
    console.log('9. Controllers initialized:', Object.keys(this.controllers));

    console.log('10. Setting up middleware');
    this.setupMiddleware();
    console.log('11. Middleware setup complete');

    console.log('12. Configuring storage type');
    this.configureStorageType();
    console.log('13. Storage type configured');

    console.log('=== Application Initialization Complete ===\n');
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