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
  CommentService
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
  CommentController
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
    useS3: false,
    s3: {
      region: process.env.STORAGE_S3_REGION,
      accessKey: process.env.STORAGE_S3_ACCESS_KEY,
      secretKey: process.env.STORAGE_S3_SECRET_KEY,
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
    cloudwatch: {
      logGroupName: '/aws/express/myapp',
      region: 'ap-northeast-1'
    }
  },
  auth: {
    sessionSecret: process.env.SESSION_SECRET || 'your-session-secret',
    sessionMaxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
};

// Utility Functions
const utils = {
  generateUniqueFileName(originalName) {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    const fileExtension = path.extname(originalName);
    return `uploads/${uniqueSuffix}${fileExtension}`;
  },

  isApiRequest(req) {
    return req.xhr || req.headers.accept?.includes('application/json');
  },

  createResponse(isApi, { status = 200, message, data, redirectUrl }) {
    return isApi
      ? { status, json: { success: status < 400, message, data } }
      : { status, redirect: redirectUrl, flash: message };
  }
};

// ロギングシステムの設定と管理
class LoggingSystem {
  constructor() {
    this.setupLogDirectory();
    this.logger = this.createLogger();
  }

  setupLogDirectory() {
    const logDir = path.join(__dirname, '..', 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  createLogger() {
    return winston.createLogger({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        this.createConsoleTransport(),
        this.createErrorFileTransport(),
        this.createCombinedFileTransport(),
        this.createCloudWatchTransport()
      ]
    });
  }

  createConsoleTransport() {
    return new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple(),
        winston.format.printf(({ level, message, timestamp }) => {
          return `${timestamp} ${level}: ${message}`;
        })
      )
    });
  }

  createErrorFileTransport() {
    return new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    });
  }

  createCombinedFileTransport() {
    return new winston.transports.File({
      filename: 'logs/combined.log',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    });
  }

  createCloudWatchTransport() {
    return new WinstonCloudWatch({
      logGroupName: '/aws/express/myapp',
      logStreamName: `express-${new Date().toISOString().slice(0, 10)}`,
      awsRegion: 'ap-northeast-1',
      awsOptions: {
        credentials: {
          accessKeyId: process.env.STORAGE_S3_ACCESS_KEY,
          secretAccessKey: process.env.STORAGE_S3_SECRET_KEY
        }
      }
    });
  }

  getLogger() {
    return this.logger;
  }
}

// ストレージ設定を管理するクラス
class StorageConfig {
  constructor() {
    this.config = {
      region: process.env.STORAGE_S3_REGION,
      bucket: process.env.STORAGE_S3_BUCKET,
      cloudfront: {
        url: process.env.STORAGE_CDN_URL,
        distributionId: process.env.STORAGE_CDN_DISTRIBUTION_ID
      },
      uploadLimits: {
        fileSize: 5 * 1024 * 1024,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif']
      }
    };
  }

  isEnabled() {
    return CONFIG.storage.useS3;
  }

  getS3Client() {
    if (!this.isEnabled()) return null;
    
    return new S3Client({
      region: this.config.region,
      credentials: {
        accessKeyId: process.env.STORAGE_S3_ACCESS_KEY,
        secretAccessKey: process.env.STORAGE_S3_SECRET_KEY
      }
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
    console.log('Using S3 storage with CloudFront');
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
    console.log('Using local storage for uploads');
    const uploadDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    return multer({
      storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, uploadDir),
        filename: this.createKeyGenerator()
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
    
    return this.storageConfig.isEnabled()
      ? `${this.storageConfig.getCloudFrontUrl()}/${file.key}`
      : `/uploads/${file.filename}`;
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
      error: error.message,
      name: error.name,
      code: error.code,
      stack: error.stack,
      details: error.details || {},
      timestamp: new Date().toISOString(),
      userId: req.user?.id,
      requestInfo: {
        method: req.method,
        path: req.path,
        url: req.url,
        params: req.params,
        query: req.query,
        body: req.body,
        headers: req.headers,
        file: req.file,
        session: req.session ? {
          id: req.session.id,
          cookie: req.session.cookie
        } : undefined
      },
      ...additionalInfo
    };

    console.error(`${error.name || 'Error'} Details:`, errorDetails);
    if (this.logger) {
      this.logger.error(`${error.name || 'Error'} Details:`, errorDetails);
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
    
    this.initializeCore();
    this.services = this.initializeServices();
    this.controllers = this.initializeControllers();
  }

  initializeCore() {
    const loggingSystem = new LoggingSystem();
    this.logger = loggingSystem.getLogger();
    
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
      comment: new CommentService(this.prisma, this.logger)
    };
  }

  initializeControllers() {
    return {
      auth: new AuthController(this.services.auth, this.errorHandler, this.logger),
      profile: new ProfileController(
        { 
          profile: this.services.profile,
          micropost: this.services.micropost
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
      comment: new CommentController(this.services, this.errorHandler, this.logger)
    };
  }

  setupMiddleware() {
    setupBasicMiddleware(this.app);
    setupAuthMiddleware(this.app, CONFIG);
    setupRequestLogging(this.app, this.logger);
    setupErrorLogging(this.app, this.logger);
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
        const host = CONFIG.app.host;
        const { publicIp, privateIp } = await this.services.system.getInstanceMetadata();
        
        this.app.listen(this.port, host, () => {
          this.logServerStartup(publicIp, privateIp);
        });
      }
    } catch (err) {
      this.logger.error('Application startup error:', err);
      process.exit(1);
    }
  }

  logServerStartup(publicIp, privateIp) {
    console.log('\n=== Server Information ===');
    console.log(`Environment: ${CONFIG.app.env}`);
    console.log(`Storage:     ${this.storageConfig.isEnabled() ? 'S3' : 'Local'}`);
    console.log('\n=== Access URLs ===');
    console.log(`Local:       http://localhost:${this.port}`);
    console.log(`Public:      http://${publicIp}:${this.port}`);
    console.log(`Private:     http://${privateIp}:${this.port}`);
    console.log('\n=== Server is ready ===\n');
  }

  async cleanup() {
    await this.prisma.$disconnect();
  }
}

if (require.main === module) {
  const app = new Application();
  app.start();

  ['SIGINT', 'SIGTERM'].forEach(signal => {
    process.on(signal, async () => {
      console.log(`\nReceived ${signal}, cleaning up...`);
      await app.cleanup();
      process.exit(0);
    });
  });
}

module.exports = { Application };