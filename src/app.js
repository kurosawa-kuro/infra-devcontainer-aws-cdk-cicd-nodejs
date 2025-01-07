const express = require('express');
const winston = require('winston');
const WinstonCloudWatch = require('winston-cloudwatch');
const path = require('path');
const multer = require('multer');
const { PrismaClient } = require('@prisma/client');
const { S3Client } = require('@aws-sdk/client-s3');
const multerS3 = require('multer-s3');
const fs = require('fs');
require('dotenv').config();
const passport = require('passport');

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
  },
  logging: {
    useCloudWatch: process.env.USE_CLOUDWATCH === 'true',
    cloudwatch: {
      logGroupName: '/aws/CdkJavascript01/myapp',
      region: process.env.AWS_REGION,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  },
  auth: {
    sessionSecret: process.env.SESSION_SECRET || 'your-session-secret',
    sessionMaxAge: parseInt(process.env.SESSION_MAX_AGE, 10) || 24 * 60 * 60 * 1000
  }
};

// ロギングシステムの設定と管理
class LoggingSystem {
  constructor() {
    this.setupLogDirectory();
    this.logger = this.createLogger();
  }

  isEnabled() {
    return CONFIG.logging.useCloudWatch;
  }

  setupLogDirectory() {
    const logDir = path.join(__dirname, '..', 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  // ロガーインスタンスを取得するメソッド
  getLogger() {
    return this.logger;
  }

  createLogger() {
    const transports = [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.printf(({ timestamp, level, message }) => {
            return `${timestamp} ${level}: ${message}`;
          })
        )
      })
    ];

    if (CONFIG.logging.useCloudWatch) {
      // 日付ベースのログストリーム名を生成
      const date = new Date();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const logStreamName = `express-${year}-${month}-${day}`;

      
      const cloudWatchTransport = new WinstonCloudWatch({
        // CLOUDWATCH_LOG_GROUP
        logGroupName: process.env.CLOUDWATCH_LOG_GROUP,
        logStreamName: logStreamName,
        awsRegion: 'ap-northeast-1',
        messageFormatter: ({ level, message }) => JSON.stringify({
          timestamp: new Date().toISOString(),
          level: level,
          message: message
        })
      });

      cloudWatchTransport.on('error', (err) => {
        console.error('CloudWatch logging error:', err);
      });

      transports.push(cloudWatchTransport);
    }

    return winston.createLogger({
      format: winston.format.simple(),
      transports: transports
    });
  }

  // ユーザーアクションのログ
  logUserAction(action, user, value = 0, additionalData = {}) {
    this.logger.info('USER_ACTION', {
      category: 'User',
      action,
      value,
      userId: user.id,
      userName: user.name,
      role: user.userRoles?.[0]?.role?.name,
      ...additionalData
    });
  }

  // コンテンツ関連アクションのログ
  logContentAction(action, content, user, value = 0, additionalData = {}) {
    this.logger.info('CONTENT_ACTION', {
      category: 'Content',
      action,
      value,
      contentId: content.id,
      contentType: 'Micropost',
      contentTitle: content.title,
      userId: user?.id,
      userName: user?.name,
      categoryName: content.categories?.[0]?.category?.name,
      ...additionalData
    });
  }

  // インタラクションのログ
  logInteraction(action, type, user, target, value = 0, additionalData = {}) {
    this.logger.info('INTERACTION', {
      category: 'Interaction',
      action,
      value,
      interactionType: type,
      userId: user.id,
      userName: user.name,
      targetUserId: target.userId,
      targetContentId: target.contentId,
      ...additionalData
    });
  }

  // 通知のログ
  logNotification(action, notification, additionalData = {}) {
    this.logger.info('NOTIFICATION', {
      category: 'Notification',
      action,
      value: 1,
      notificationType: notification.type,
      notificationStatus: notification.read ? 'READ' : 'UNREAD',
      userId: notification.recipientId,
      targetUserId: notification.actorId,
      contentId: notification.micropostId,
      ...additionalData
    });
  }

  // エラーログ
  logError(category, action, error, metadata = {}) {
    this.logger.error('ERROR', {
      category,
      action,
      value: error.code || 500,
      errorCode: error.code,
      errorMessage: error.message,
      errorStack: error.stack,
      ...metadata
    });
  }

  // ビジネスアクションのログ
  logBusinessAction(action, data) {
    this.logger.info('BUSINESS_ACTION', {
      category: data.category || 'Business',
      action,
      value: data.value || 0,
      environment: process.env.NODE_ENV || 'development',
      actionType: data.actionType,
      targetType: data.targetType,
      targetId: data.targetId,
      result: data.result,
      actorId: data.actor?.id,
      actorName: data.actor?.name,
      targetUserId: data.target?.id,
      targetUserName: data.target?.name
    });
  }

  // HTTPリクエストのログ
  logHttpRequest(req, res, responseTime) {
    this.logger.info('HTTP_REQUEST', {
      category: 'Http',
      action: `${req.method} ${res.statusCode} ${req.originalUrl}`,
      value: responseTime,
      environment: process.env.NODE_ENV || 'development',
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      responseTime: responseTime,
      userId: req.user?.id,
      userName: req.user?.name
    });
  }
}

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
  constructor(uploadLimits, logger) {
    this.uploadLimits = uploadLimits;
    this.logger = logger;
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

    if (this.logger) {
      this.logger.logError('Error', error.name || 'UnknownError', error, errorDetails);
    }

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
    
    // Prismaインスタンスを設定
    this.app.set('prisma', this.prisma);
    
    this.initializeCore();
    this.services = this.initializeServices();
    this.controllers = this.initializeControllers();
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
    const loggingSystem = new LoggingSystem();
    // Winstonロガーインスタンスを取得
    this.logger = loggingSystem.getLogger();
    // LoggingSystemインスタンスも保持
    this.loggingSystem = loggingSystem;
    
    this.storageConfig = new StorageConfig();
    this.fileUploader = new FileUploader(this.storageConfig);
    this.errorHandler = new ErrorHandler(this.storageConfig.getUploadLimits(), this.logger);

    const passportService = new PassportService(this.prisma, this.logger);
    passportService.configurePassport(passport);
  }

  initializeServices() {
    return {
      auth: new AuthService(this.prisma, this.logger),
      profile: new ProfileService(this.prisma, this.logger),
      micropost: new MicropostService(this.prisma, this.logger),
      system: new SystemService(this.prisma, this.logger),
      category: new CategoryService(this.prisma, this.logger),
      passport: new PassportService(this.prisma, this.logger),
      like: new LikeService(this.prisma, this.logger),
      comment: new CommentService(this.prisma, this.logger),
      notification: new NotificationService(this.prisma, this.logger),
      follow: new FollowService(this.prisma, this.logger)
    };
  }

  initializeControllers() {
    return {
      auth: new AuthController(this.services.auth, this.errorHandler, this.logger),
      profile: new ProfileController(
        { 
          profile: this.services.profile,
          micropost: this.services.micropost,
          follow: this.services.follow
        },
        this.errorHandler,
        this.logger
      ),
      micropost: new MicropostController(
        { 
          micropost: this.services.micropost, 
          like: this.services.like,
          comment: this.services.comment 
        },
        this.fileUploader,
        this.errorHandler,
        this.logger
      ),
      system: new SystemController(this.services.system, this.errorHandler, this.logger),
      dev: new DevController(
        { 
          system: this.services.system,
          profile: this.services.profile,
          micropost: this.services.micropost
        },
        this.errorHandler,
        this.logger
      ),
      admin: new AdminController(this.services, this.errorHandler, this.logger),
      category: new CategoryController(this.services.category, this.errorHandler, this.logger),
      like: new LikeController(this.services.like, this.errorHandler, this.logger),
      comment: new CommentController(this.services, this.errorHandler, this.logger),
      notification: new NotificationController(this.services, this.errorHandler, this.logger)
    };
  }

  setupMiddleware() {
    setupBasicMiddleware(this.app);
    setupAuthMiddleware(this.app, CONFIG);
    setupRequestLogging(this.app, this.loggingSystem);  // LoggingSystemインスタンスを渡す
    setupErrorLogging(this.app, this.logger);           // Winstonロガーを渡す
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
      this.logger.error('Application startup error:', err);
      process.exit(1);
    }
  }

  logServerStartup() {
    console.log('\n=== Server Information ===');
    console.log(`Environment: ${CONFIG.app.env}`);
    console.log(`Storage:     ${this.storageConfig.isEnabled() ? 'S3' : 'Local'}`);
    console.log(`CloudWatch:  ${this.loggingSystem.isEnabled() ? 'Enabled' : 'Disabled'}`);
    console.log(`Server:      http://${CONFIG.app.host}:${this.port}`);
    console.log('\n=== Server is ready ===\n');
  }

  async cleanup() {
    await this.prisma.$disconnect();
  }
}

const app = new Application();
app.start().catch(err => {
  console.error('Failed to start application:', err);
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT, cleaning up...');
  await app.cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nReceived SIGTERM, cleaning up...');
  await app.cleanup();
  process.exit(0);
});

module.exports = { Application };