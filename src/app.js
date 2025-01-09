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

const setupRoutes = require('./routes');
const {
  setupBasicMiddleware,
  setupAuthMiddleware,
  setupRequestLogging,
  setupErrorLogging,
  setupSecurity,
  handle500Error
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

// 環境変数からパスと制限を設定
const PATHS = {
  DEFAULT_AVATAR: process.env.DEFAULT_AVATAR_PATH,
  UPLOAD_DIR: process.env.UPLOAD_DIR_PATH,
  PUBLIC_DIR: process.env.PUBLIC_DIR_PATH
};

const LIMITS = {
  MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE),
  MAX_TITLE_LENGTH: parseInt(process.env.MAX_TITLE_LENGTH),
  MAX_CONTENT_LENGTH: parseInt(process.env.MAX_CONTENT_LENGTH)
};

// Constants and Configuration
const CONFIG = {
  app: {
    port: process.env.APP_PORT || 8080,
    host: process.env.APP_HOST || '0.0.0.0',
    env: process.env.APP_ENV || 'development',
    isProduction: process.env.NODE_ENV === 'production',
    isTest: process.env.APP_ENV === 'test'
  },
  storage: {
    useS3: process.env.USE_S3 === 'true',
    s3: {
      region: process.env.AWS_REGION,
      accessKey: process.env.AWS_ACCESS_KEY_ID,
      secretKey: process.env.AWS_SECRET_ACCESS_KEY,
      bucket: process.env.STORAGE_S3_BUCKET
    },
    cloudfront: {
      url: process.env.STORAGE_CDN_URL,
      distributionId: process.env.STORAGE_CDN_DISTRIBUTION_ID
    },
    limits: {
      fileSize: 5 * 1024 * 1024,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif']
    }
  }
};

// ストレージ設定を管理するクラス
class StorageConfig {
  constructor() {
    this.config = {
      region: CONFIG.storage.s3.region,
      bucket: CONFIG.storage.s3.bucket,
      credentials: {
        accessKeyId: CONFIG.storage.s3.accessKey,
        secretAccessKey: CONFIG.storage.s3.secretKey
      },
      cloudfront: {
        url: CONFIG.storage.cloudfront.url,
        distributionId: CONFIG.storage.cloudfront.distributionId
      },
      uploadLimits: CONFIG.storage.limits
    };
  }

  isEnabled() {
    return CONFIG.storage.useS3;
  }

  getS3Client() {
    if (!this.isEnabled()) return null;
    
    return new S3Client({
      region: this.config.region,
      credentials: this.config.credentials
    });
  }

  getUploadLimits() {
    return this.config.uploadLimits;
  }

  getCloudFrontUrl() {
    return this.config.cloudfront.url;
  }

  getBucketName() {
    return this.config.bucket;
  }
}

// ファイルアップロードを管理するクラス
class FileUploader {
  constructor(storageConfig) {
    this.storageConfig = storageConfig;
    this.s3Client = storageConfig.getS3Client();
    this.uploader = this.createUploader();
  }

  createFileFilter() {
    return (req, file, cb) => {
      const allowedMimeTypes = this.storageConfig.getUploadLimits().allowedMimeTypes;
      if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error(`対応していないファイル形式です。対応形式: ${allowedMimeTypes.join(', ')}`));
      }
    };
  }

  getUploader() {
    return this.uploader;
  }

  createUploader() {
    if (this.storageConfig.isEnabled()) {
      return this.createS3Uploader();
    } else {
      return this.createLocalUploader();
    }
  }

  createS3Uploader() {
    return multer({
      storage: multerS3({
        s3: this.s3Client,
        bucket: this.storageConfig.getBucketName(),
        contentType: multerS3.AUTO_CONTENT_TYPE,
        metadata: this.createMetadataHandler(),
        key: this.createKeyGenerator()
      }),
      limits: this.storageConfig.getUploadLimits(),
      fileFilter: this.createFileFilter()
    });
  }

  createLocalUploader() {
    const uploadDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    return multer({
      storage: multer.diskStorage({
        destination: (req, file, cb) => {
          cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
          const fileExtension = path.extname(file.originalname);
          const filename = `${uniqueSuffix}${fileExtension}`;
          cb(null, filename);
        }
      }),
      limits: this.storageConfig.getUploadLimits(),
      fileFilter: this.createFileFilter()
    });
  }

  createMetadataHandler() {
    return (req, file, cb) => {
      cb(null, {
        fieldName: file.fieldname,
        contentType: file.mimetype,
        uploadedAt: new Date().toISOString()
      });
    };
  }

  createKeyGenerator() {
    return (req, file, cb) => {
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
      const fileExtension = path.extname(file.originalname);
      const fileName = `${uniqueSuffix}${fileExtension}`;
      cb(null, fileName);
    };
  }

  generateFileUrl(file) {
    if (!file) return null;
    
    if (this.storageConfig.isEnabled()) {
      return `${this.storageConfig.getCloudFrontUrl()}/${file.key}`;
    } else {
      return `/uploads/${file.filename}`;
    }
  }
}

// エラーハンドリングを管理するクラス
class ErrorHandler {
  constructor(uploadLimits) {
    this.uploadLimits = uploadLimits;
  }

  createDetailedErrorLog(error, req, additionalInfo = {}) {
    const errorDetails = {
      category: 'Error',
      action: error.name || 'UnknownError',
      value: error.code || 500,
      quantity: 1,
      error: error.message,
      details: error.details || {},
      userId: req.user?.id,
      requestInfo: {
        method: req.method,
        path: req.path,
        url: req.url
      }
    };

    logger.logError(error, req);

    return errorDetails;
  }

  createValidationError(message, details = {}) {
    const error = new Error(message);
    error.name = 'ValidationError';
    error.code = details.code || 'VALIDATION_ERROR';
    error.details = {
      field: details.field,
      value: details.value,
      constraint: details.constraint,
      ...details
    };
    return error;
  }

  handle(err, req, res) {
    this.createDetailedErrorLog(err, req);
    
    if (err instanceof multer.MulterError) {
      return this.handleMulterError(err, req, res);
    }

    return this.handleGeneralError(err, req, res);
  }

  handleMulterError(err, req, res) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      const error = this.createValidationError(
        `ファイルサイズが大きすぎます。${this.uploadLimits.fileSize / (1024 * 1024)}MB以下にしてください。`,
        { code: 'LIMIT_FILE_SIZE', field: err.field }
      );
      this.createDetailedErrorLog(error, req);
      return this.sendErrorResponse(req, res, 400, error.message);
    }
    
    const error = this.createValidationError('ファイルアップロードエラー', {
      code: err.code,
      field: err.field
    });
    this.createDetailedErrorLog(error, req);
    return this.sendErrorResponse(req, res, 400, error.message);
  }

  handleGeneralError(err, req, res) {
    const errorDetails = this.createDetailedErrorLog(err, req);
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? 'サーバーエラーが発生しました' 
      : err.message;
    
    return this.sendErrorResponse(
      req, 
      res, 
      err.status || 500, 
      errorMessage,
      process.env.NODE_ENV !== 'production' ? errorDetails : undefined
    );
  }

  sendErrorResponse(req, res, status, message, details = {}) {
    const isApiRequest = req.xhr || req.headers.accept?.includes('application/json');
    
    if (isApiRequest) {
      return res.status(status).json({
        error: message,
        ...details
      });
    } else {
      try {
        if (req.session && req.flash) {
          req.flash('error', message);
        }
      } catch (e) {
        // Ignore flash errors if session is not available
      }
      const fallbackUrl = req.header('Referer') || '/';
      return res.redirect(fallbackUrl);
    }
  }

  handleValidationError(req, res, message, details = {}) {
    const error = this.createValidationError(message, details);
    this.createDetailedErrorLog(error, req);
    return this.sendErrorResponse(req, res, 400, error.message);
  }

  handleAuthError(req, res, message = '認証が必要です') {
    const error = this.createValidationError(message, { code: 'AUTH_ERROR' });
    this.createDetailedErrorLog(error, req);
    return this.sendErrorResponse(req, res, 401, error.message);
  }

  handlePermissionError(req, res, message = '権限がありません') {
    const error = this.createValidationError(message, { code: 'PERMISSION_ERROR' });
    this.createDetailedErrorLog(error, req);
    return res.status(403).json({
      error: message
    });
  }

  handleNotFoundError(req, res, message = 'リソースが見つかりません') {
    const error = this.createValidationError(message, { code: 'NOT_FOUND' });
    this.createDetailedErrorLog(error, req);
    return this.sendErrorResponse(req, res, 404, error.message);
  }
}

// メインのアプリケーションクラス
class Application {
  constructor() {
    this.app = express();
    this.prisma = new PrismaClient();
    this.port = CONFIG.app.port;
    
    this.setupDirectories();
    setupSecurity(this.app);
    this.app.use(express.static(path.join(__dirname, 'public')));
    this.app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
    
    // Prismaインスタンスを設定
    this.app.set('prisma', this.prisma);
    
    this.initializeCore();
    this.services = this.initializeServices();
    this.controllers = this.initializeControllers();

    // グローバル変数の設定
    this.app.locals.PATHS = PATHS;
    this.app.locals.LIMITS = LIMITS;
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
    this.storageConfig = new StorageConfig();
    this.fileUploader = new FileUploader(this.storageConfig);
    this.errorHandler = new ErrorHandler(this.storageConfig.getUploadLimits());

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
  }

  setupRoutes() {
    setupRoutes(this.app, this.controllers, this.fileUploader);
  }

  setupErrorHandler() {
    this.app.use(handle500Error);
  }

  async start() {
    try {
      this.setupMiddleware();
      this.setupRoutes();
      this.setupErrorHandler();

      if (!CONFIG.app.isTest) {
        this.app.listen(this.port, CONFIG.app.host, () => {
          this.logServerStartup();
        });
      }
    } catch (err) {
      logger.error('Application startup error:', { error: err });
      process.exit(1);
    }
  }

  logServerStartup() {
    logger.info('Server Information', {
      environment: CONFIG.app.env,
      storage: this.storageConfig.isEnabled() ? 'S3' : 'Local',
      server: `http://${CONFIG.app.host}:${this.port}`
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