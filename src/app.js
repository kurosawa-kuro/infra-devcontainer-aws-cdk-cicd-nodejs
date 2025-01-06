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
      logGroupName: process.env.CLOUDWATCH_LOG_GROUP,
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
    // ANSIエスケープコードを除去する関数
    const stripAnsi = (str) => {
      return str.replace(/\u001b\[\d+m/g, '');
    };

    // CloudWatch用のシンプルなフォーマット
    const cloudWatchFormat = winston.format.printf(({ timestamp, level, message, ...metadata }) => {
      // Expressのログメッセージをパースする
      const parseExpressLog = (msg) => {
        const regex = /^([A-Z]+)\s+(?:\x1b\[\d+m)*(\d+)(?:\x1b\[0m)*\s+([^\s]+)\s+(\d+)ms/;
        const match = msg.match(regex);
        if (match) {
          return {
            method: match[1],
            statusCode: match[2],
            path: match[3],
            responseTime: match[4]
          };
        }
        return null;
      };

      const logDate = new Date(timestamp).toISOString().split('T')[0];
      let method, path, statusCode, responseTime;

      // メッセージがExpressのログフォーマットの場合はパースする
      const parsedLog = parseExpressLog(stripAnsi(message));
      if (parsedLog) {
        method = parsedLog.method;
        path = parsedLog.path;
        statusCode = parsedLog.statusCode;
        responseTime = parsedLog.responseTime;
      } else {
        // メタデータから取得（既存のフォールバック）
        method = metadata.requestInfo?.method || '';
        path = metadata.requestInfo?.path || '';
        statusCode = metadata.statusCode || '';
        responseTime = metadata.responseTime || '';
      }

      // CloudWatch用のJSON形式
      const logData = {
        timestamp: new Date().toISOString(),
        Category: metadata.category || 'System',
        Action: `${method} ${statusCode} ${path} ${responseTime}ms`,
        Value: metadata.value || 0,
        Quantity: metadata.quantity || 1,
        Environment: process.env.NODE_ENV,
        ErrorMessage: metadata.errorMessage || ''
      };

      // null/undefined値を除去
      Object.keys(logData).forEach(key => {
        if (logData[key] === null || logData[key] === undefined || logData[key] === '') {
          delete logData[key];
        }
      });

      return JSON.stringify(logData);
    });

    // JSON形式の詳細ログフォーマット
    const jsonLogFormat = winston.format.printf(({ timestamp, level, message, ...metadata }) => {
      const logDate = new Date(timestamp).toISOString().split('T')[0];
      const category = metadata.category || 'System';
      const action = stripAnsi(metadata.action || message);
      const value = metadata.value || 0;
      const quantity = metadata.quantity || 1;
      
      // Athena用の構造化ログフォーマット
      const logData = {
        // 基本情報
        timestamp: new Date().toISOString(),
        Category: category,
        Action: action,
        Value: value,
        Quantity: quantity,

        // ユーザー関連情報
        UserId: metadata.userId,
        UserEmail: metadata.userEmail,
        UserName: metadata.userName,
        UserRole: metadata.userRole,

        // コンテンツ関連情報
        ContentId: metadata.contentId,
        ContentType: metadata.contentType,
        ContentTitle: metadata.contentTitle,
        CategoryId: metadata.categoryId,
        CategoryName: metadata.categoryName,

        // インタラクション情報
        InteractionType: metadata.interactionType,
        TargetUserId: metadata.targetUserId,
        TargetContentId: metadata.targetContentId,

        // 通知関連情報
        NotificationType: metadata.notificationType,
        NotificationStatus: metadata.notificationStatus,

        // システム情報
        Environment: process.env.NODE_ENV,
        IPAddress: metadata.ipAddress,
        UserAgent: metadata.userAgent,
        
        // エラー情報（存在する場合）
        ErrorCode: metadata.errorCode,
        ErrorMessage: stripAnsi(metadata.errorMessage || ''),
        ErrorStack: metadata.errorStack,

        // リクエスト情報
        RequestInfo: metadata.requestInfo,

        // 追加のメタデータ
        ...metadata.additionalData
      };

      // null/undefined値を除去
      Object.keys(logData).forEach(key => {
        if (logData[key] === null || logData[key] === undefined) {
          delete logData[key];
        }
      });

      return JSON.stringify(logData);
    });

    const transports = [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp(),
          jsonLogFormat
        )
      }),
      new winston.transports.File({
        filename: 'logs/error.log',
        level: 'error',
        format: winston.format.combine(
          winston.format.timestamp(),
          jsonLogFormat
        )
      }),
      new winston.transports.File({
        filename: 'logs/combined.log',
        format: winston.format.combine(
          winston.format.timestamp(),
          jsonLogFormat
        )
      })
    ];

    if (CONFIG.logging.useCloudWatch) {
      const cloudWatchTransport = new WinstonCloudWatch({
        logGroupName: CONFIG.logging.cloudwatch.logGroupName,
        logStreamName: `express-${new Date().toISOString().split('T')[0]}`,
        awsRegion: CONFIG.logging.cloudwatch.region,
        awsOptions: {
          credentials: {
            accessKeyId: CONFIG.logging.cloudwatch.accessKeyId,
            secretAccessKey: CONFIG.logging.cloudwatch.secretAccessKey
          }
        },
        messageFormatter: ({ level, message, ...meta }) => {
          return meta.metadata ? message : JSON.stringify(meta);
        },
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.metadata({ 
            fillWith: [
              'category', 'action', 'value', 'quantity',
              'requestInfo', 'statusCode', 'responseTime',
              'errorMessage'
            ] 
          }),
          cloudWatchFormat
        )
      });
        transports.push(cloudWatchTransport);
    }

    return winston.createLogger({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.metadata({ 
          fillWith: [
            'category', 'action', 'value', 'quantity',
            'userId', 'userEmail', 'userName', 'userRole',
            'contentId', 'contentType', 'contentTitle',
            'categoryId', 'categoryName',
            'interactionType', 'targetUserId', 'targetContentId',
            'notificationType', 'notificationStatus',
            'ipAddress', 'userAgent',
            'errorCode', 'errorMessage', 'errorStack',
            'requestInfo', 'statusCode', 'responseTime',
            'additionalData'
          ] 
        }),
        jsonLogFormat
      ),
      transports: transports
    });
  }

  // ユーザーアクションのログ
  logUserAction(action, user, value = 0, additionalData = {}) {
    this.logger.info(action, {
      category: 'User',
      action,
      value,
      quantity: 1,
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      userRole: user.userRoles?.[0]?.role?.name,
      additionalData
    });
  }

  // コンテンツ関連アクションのログ
  logContentAction(action, content, user, value = 0, additionalData = {}) {
    this.logger.info(action, {
      category: 'Content',
      action,
      value,
      quantity: 1,
      contentId: content.id,
      contentType: 'Micropost',
      contentTitle: content.title,
      userId: user?.id,
      userName: user?.name,
      categoryName: content.categories?.[0]?.category?.name,
      additionalData
    });
  }

  // インタラクションのログ
  logInteraction(action, type, user, target, value = 0, additionalData = {}) {
    this.logger.info(action, {
      category: 'Interaction',
      action,
      value,
      quantity: 1,
      interactionType: type,
      userId: user.id,
      userName: user.name,
      targetUserId: target.userId,
      targetContentId: target.contentId,
      additionalData
    });
  }

  // 通知のログ
  logNotification(action, notification, additionalData = {}) {
    this.logger.info(action, {
      category: 'Notification',
      action,
      value: 1,
      quantity: 1,
      notificationType: notification.type,
      notificationStatus: notification.read ? 'READ' : 'UNREAD',
      userId: notification.recipientId,
      targetUserId: notification.actorId,
      contentId: notification.micropostId,
      additionalData
    });
  }

  // エラーログ
  logError(category, action, error, metadata = {}) {
    this.logger.error(action, {
      category,
      action,
      value: error.code || 500,
      quantity: 1,
      errorCode: error.code,
      errorMessage: error.message,
      errorStack: error.stack,
      ...metadata
    });
  }

  // ビジネスアクションのログ
  logBusinessAction(action, data) {
    const logData = {
      timestamp: new Date().toISOString(),
      Category: data.category || 'Business',
      Action: action,
      Value: data.value || 0,
      Quantity: data.quantity || 1,
      Environment: process.env.NODE_ENV || 'development',
      ErrorMessage: '',
      Details: {
        actionType: data.actionType,
        targetType: data.targetType,
        targetId: data.targetId,
        result: data.result
      },
      Actor: data.actor ? {
        id: data.actor.id,
        name: data.actor.name
      } : null,
      Target: data.target ? {
        id: data.target.id,
        name: data.target.name
      } : null
    };

    // null値の削除
    Object.keys(logData).forEach(key => {
      if (logData[key] === null || logData[key] === undefined) {
        delete logData[key];
      }
    });

    this.logger.info(JSON.stringify(logData));
  }

  // HTTPリクエストのログ
  logHttpRequest(req, res, responseTime) {
    const logData = {
      timestamp: new Date().toISOString(),
      Category: 'Http',
      Action: `${req.method} ${res.statusCode} ${req.originalUrl}`,
      Value: responseTime,
      Quantity: 1,
      Environment: process.env.NODE_ENV || 'development',
      ErrorMessage: '',
      RequestInfo: {
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        responseTime: responseTime
      },
      User: req.user ? {
        id: req.user.id,
        name: req.user.name
      } : null
    };

    // null値の削除
    Object.keys(logData).forEach(key => {
      if (logData[key] === null || logData[key] === undefined) {
        delete logData[key];
      }
    });

    this.logger.info(JSON.stringify(logData));
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