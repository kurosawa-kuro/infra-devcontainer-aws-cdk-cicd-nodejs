const express = require('express');
const asyncHandler = require('express-async-handler');
const winston = require('winston');
const WinstonCloudWatch = require('winston-cloudwatch');
const expressWinston = require('express-winston');
const path = require('path');
const multer = require('multer');
const { PrismaClient } = require('@prisma/client');
const { S3Client } = require('@aws-sdk/client-s3');
const multerS3 = require('multer-s3');
const fs = require('fs');
const axios = require('axios');
const expressLayouts = require('express-ejs-layouts');
require('dotenv').config();
const bcrypt = require('bcrypt');
const passport = require('passport');
const session = require('express-session');
const flash = require('connect-flash');

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
  async withErrorHandling(req, res, handler, errorHandler) {
    try {
      await handler();
    } catch (error) {
      errorHandler.handle(error, req, res);
    }
  },

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

// Base Interfaces
class BaseService {
  constructor(prisma, logger) {
    this.prisma = prisma;
    this.logger = logger;
  }

  logError(error, context = {}) {
    this.logger.error({
      message: error.message,
      stack: error.stack,
      ...context
    });
  }
}

class BaseController {
  constructor(service, errorHandler, logger) {
    this.service = service;
    this.errorHandler = errorHandler;
    this.logger = logger;
  }

  async handleRequest(req, res, handler) {
    return utils.withErrorHandling(req, res, handler, this.errorHandler);
  }

  sendResponse(req, res, { status = 200, message, data, redirectUrl }) {
    const response = utils.createResponse(utils.isApiRequest(req), {
      status,
      message,
      data,
      redirectUrl
    });

    if (response.json) {
      return res.status(response.status).json(response.json);
    }

    if (response.flash) {
      req.flash('success', response.flash);
    }
    return res.redirect(response.redirect);
  }
}

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
    const uploadDir = path.join(__dirname, '..', 'uploads');
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
      : `uploads/${file.filename}`;
  }
}

// エラーハンドリングを管理するクラス
class ErrorHandler {
  constructor(uploadLimits, logger) {
    this.uploadLimits = uploadLimits;
    this.logger = logger;
  }

  // 詳細なエラーログを生成する共通関数
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

    // エラー詳細をログに出力
    console.error(`${error.name || 'Error'} Details:`, errorDetails);
    if (this.logger) {
      this.logger.error(`${error.name || 'Error'} Details:`, errorDetails);
    }

    return errorDetails;
  }

  // バリデーションエラーを作成する共通関数
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

  handle(err, req, res, next) {
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

  // 共通のエラーレスポンス送信関数
  sendErrorResponse(req, res, status, message, details = {}) {
    const isApiRequest = req.xhr || req.headers.accept?.includes('application/json');
    
    if (isApiRequest) {
      return res.status(status).json({
        error: message,
        ...details
      });
    } else {
      req.flash('error', message);
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
    return this.sendErrorResponse(req, res, 403, error.message);
  }

  handleNotFoundError(req, res, message = 'リソースが見つかりません') {
    const error = this.createValidationError(message, { code: 'NOT_FOUND' });
    this.createDetailedErrorLog(error, req);
    return this.sendErrorResponse(req, res, 404, error.message);
  }
}

// 各コントローラーを基底クラスを継承するように修正
class AuthController extends BaseController {
  constructor(service, errorHandler, logger) {
    super(service, errorHandler, logger);
  }

  getSignupPage(req, res) {
    return this.handleRequest(req, res, async () => {
      res.render('auth/signup', { 
        title: 'ユーザー登録',
        path: req.path
      });
    });
  }

  getLoginPage(req, res) {
    return this.handleRequest(req, res, async () => {
      res.render('auth/login', { 
        title: 'ログイン',
        path: req.path
      });
    });
  }

  async signup(req, res) {
    return this.handleRequest(req, res, async () => {
      await this.service.signup(req.body);
      this.sendResponse(req, res, {
        message: 'ユーザー登録が完了しました。ログインしてください。',
        redirectUrl: '/auth/login'
      });
    });
  }

  async login(req, res) {
    return this.handleRequest(req, res, async () => {
      await this.service.login(req, res);
      this.sendResponse(req, res, {
        message: 'ログインしました',
        redirectUrl: '/'
      });
    });
  }

  async logout(req, res) {
    return this.handleRequest(req, res, async () => {
      await this.service.logout(req);
      this.sendResponse(req, res, {
        message: 'ログアウトしました',
        redirectUrl: '/auth/login'
      });
    });
  }
}

class MicropostController extends BaseController {
  constructor(service, fileUploader, errorHandler, logger) {
    super(service, errorHandler, logger);
    this.fileUploader = fileUploader;
  }

  async index(req, res) {
    return this.handleRequest(req, res, async () => {
      const microposts = await this.service.getAllMicroposts();
      res.render('microposts', { 
        microposts,
        title: '投稿一覧',
        path: req.path
      });
    });
  }

  async create(req, res) {
    return this.handleRequest(req, res, async () => {
      const { title } = req.body;
      if (!title?.trim()) {
        throw this.errorHandler.createValidationError('投稿内容を入力してください', {
          code: 'EMPTY_CONTENT',
          field: 'title',
          value: title,
          constraint: 'required'
        });
      }

      let imageUrl = null;
      if (req.file) {
        imageUrl = this.fileUploader.generateFileUrl(req.file);
      }

      await this.service.createMicropost({
        title: title.trim(),
        imageUrl,
        userId: req.user.id
      });
      
      this.sendResponse(req, res, {
        message: '投稿が完了しました',
        redirectUrl: '/microposts'
      });
    });
  }
}

class ProfileController extends BaseController {
  constructor(service, errorHandler, logger) {
    super(service, errorHandler, logger);
  }

  async show(req, res) {
    return this.handleRequest(req, res, async () => {
      const user = await this.service.getUserProfile(req.params.id);
      if (!user) {
        throw this.errorHandler.createValidationError('ユーザーが見つかりません', {
          code: 'NOT_FOUND',
          field: 'id',
          value: req.params.id
        });
      }

      res.render('profile/show', {
        title: 'プロフィール',
        path: req.path,
        user
      });
    });
  }

  async getEditPage(req, res) {
    return this.handleRequest(req, res, async () => {
      const user = await this.service.getUserProfile(req.params.id);
      if (!user) {
        throw this.errorHandler.createValidationError('ユーザーが見つかりません', {
          code: 'NOT_FOUND',
          field: 'id',
          value: req.params.id
        });
      }

      res.render('profile/edit', {
        title: 'プロフィール編集',
        path: req.path,
        user
      });
    });
  }

  async update(req, res) {
    return this.handleRequest(req, res, async () => {
      await this.service.updateProfile(req.params.id, req.body);
      this.sendResponse(req, res, {
        message: 'プロフィールを更新しました',
        redirectUrl: `/profile/${req.params.id}`
      });
    });
  }
}

class SystemController extends BaseController {
  constructor(service, errorHandler, logger) {
    super(service, errorHandler, logger);
  }

  async getStatus(req, res) {
    return this.handleRequest(req, res, async () => {
      const metadata = await this.service.getInstanceMetadata();
      res.render('system-status', {
        title: 'システム状態',
        path: req.path,
        metadata
      });
    });
  }
}

// サービスクラス
class AuthService extends BaseService {
  async signup(userData) {
    const { email, password, passwordConfirmation } = userData;
    
    if (!email || !password) {
      throw new Error('メールアドレスとパスワードは必須です');
    }

    if (password !== passwordConfirmation) {
      throw new Error('パスワードが一致しません');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email }
    });
    
    if (existingUser) {
      throw new Error('このメールアドレスは既に登録されています');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    return this.prisma.user.create({
      data: {
        email,
        password: hashedPassword
      }
    });
  }

  async login(req, res) {
    return new Promise((resolve, reject) => {
      passport.authenticate('local', (err, user, info) => {
        if (err) return reject(err);
        if (!user) return reject(new Error(info?.message || 'ログインに失敗しました'));
        
        req.logIn(user, (err) => {
          if (err) return reject(err);
          resolve(user);
        });
      })(req, res);
    });
  }

  async logout(req) {
    return new Promise((resolve, reject) => {
      req.logout((err) => err ? reject(err) : resolve());
    });
  }
}

class ProfileService extends BaseService {
  async getUserProfile(userId) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        bio: true,
        createdAt: true
      }
    });
  }

  async updateProfile(userId, profileData) {
    return this.prisma.user.update({
      where: { id: userId },
      data: profileData
    });
  }
}

class MicropostService extends BaseService {
  async getAllMicroposts() {
    return this.prisma.micropost.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            email: true
          }
        }
      }
    });
  }

  async createMicropost(data) {
    return this.prisma.micropost.create({
      data: {
        title: data.title,
        imageUrl: data.imageUrl,
        userId: data.userId
      },
      include: {
        user: {
          select: {
            id: true,
            email: true
          }
        }
      }
    });
  }
}

class SystemService extends BaseService {
  async getInstanceMetadata() {
    if (CONFIG.app.env === 'development') {
      return {
        publicIp: 'localhost',
        privateIp: 'localhost'
      };
    }

    try {
      const [publicIpResponse, privateIpResponse] = await Promise.all([
        axios.get('http://169.254.169.254/latest/meta-data/public-ipv4', { timeout: 2000 }),
        axios.get('http://169.254.169.254/latest/meta-data/local-ipv4', { timeout: 2000 })
      ]);
      
      return {
        publicIp: publicIpResponse.data,
        privateIp: privateIpResponse.data
      };
    } catch (error) {
      this.logError(error, { context: 'EC2 metadata fetch' });
      return {
        publicIp: 'localhost',
        privateIp: 'localhost'
      };
    }
  }
}

// メインのアプリケーションクラス
class Application {
  constructor() {
    this.app = express();
    this.prisma = new PrismaClient();
    this.port = CONFIG.app.port;
    
    this.initializeCore();
    this.initializeServices();
    this.initializeControllers();
  }

  initializeCore() {
    const loggingSystem = new LoggingSystem();
    this.logger = loggingSystem.getLogger();
    
    this.storageConfig = new StorageConfig();
    this.fileUploader = new FileUploader(this.storageConfig);
    this.errorHandler = new ErrorHandler(this.storageConfig.getUploadLimits(), this.logger);

    require('./config/passport')(passport);
  }

  initializeServices() {
    this.services = {
      auth: new AuthService(this.prisma, this.logger),
      profile: new ProfileService(this.prisma, this.logger),
      micropost: new MicropostService(this.prisma, this.logger),
      system: new SystemService(this.prisma, this.logger)
    };
  }

  initializeControllers() {
    this.controllers = {
      auth: new AuthController(this.services.auth, this.errorHandler, this.logger),
      profile: new ProfileController(this.services.profile, this.errorHandler, this.logger),
      micropost: new MicropostController(this.services.micropost, this.fileUploader, this.errorHandler, this.logger),
      system: new SystemController(this.services.system, this.errorHandler, this.logger)
    };
  }

  setupMiddleware() {
    this.setupRequestLogging();
    this.setupBasicMiddleware();
    this.setupAuthMiddleware();
    this.setupErrorLogging();
  }

  setupRequestLogging() {
    this.app.use(expressWinston.logger({
      winstonInstance: this.logger,
      meta: true,
      msg: this.createRequestLogMessage.bind(this),
      expressFormat: false,
      colorize: true,
      ignoreRoute: (req) => req.url === '/health' || req.url === '/health-db'
    }));
  }

  createRequestLogMessage(req, res) {
    const responseTime = res.responseTime || 0;
    const statusCode = res.statusCode;
    const statusColor = this.getStatusColor(statusCode);
    const reset = '\x1b[0m';
    
    const errorInfo = this.getErrorInfo(req, res);
    const requestInfo = this.getRequestInfo(req, res);

    if (statusCode >= 400) {
      console.error('Request Details:', requestInfo);
      this.logger.error('Request Details:', requestInfo);
    }

    return `${req.method.padEnd(6)} ${statusColor}${statusCode}${reset} ${req.url.padEnd(30)} ${responseTime}ms${errorInfo}`;
  }

  getStatusColor(statusCode) {
    if (statusCode >= 500) return '\x1b[31m'; // red
    if (statusCode >= 400) return '\x1b[33m'; // yellow
    if (statusCode >= 300) return '\x1b[36m'; // cyan
    return '\x1b[32m'; // green
  }

  getErrorInfo(req, res) {
    let errorInfo = '';
    if (res.locals.error) {
      errorInfo = ` - Error: ${res.locals.error}`;
    }
    if (req.flash && req.flash('error')) {
      const flashErrors = req.flash('error');
      if (flashErrors.length > 0) {
        errorInfo += ` - Flash Errors: ${flashErrors.join(', ')}`;
      }
    }
    return errorInfo;
  }

  getRequestInfo(req, res) {
    return {
      method: req.method,
      url: req.url,
      params: req.params,
      query: req.query,
      body: req.body,
      headers: req.headers,
      statusCode: res.statusCode,
      responseTime: res.responseTime
    };
  }

  setupBasicMiddleware() {
    this.app.set('view engine', 'ejs');
    this.app.set('views', path.join(__dirname, 'views'));
    this.app.use(expressLayouts);
    this.app.set('layout', 'layouts/main');
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
  }

  setupAuthMiddleware() {
    this.app.use(session({
      secret: CONFIG.auth.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: CONFIG.app.isProduction,
        maxAge: CONFIG.auth.sessionMaxAge
      }
    }));
    this.app.use(passport.initialize());
    this.app.use(passport.session());
    this.app.use(flash());

    this.app.use(this.addLocals);
  }

  addLocals(req, res, next) {
    res.locals.user = req.user;
    res.locals.error = req.flash('error');
    res.locals.success = req.flash('success');
    next();
  }

  setupErrorLogging() {
    this.app.use(expressWinston.errorLogger({
      winstonInstance: this.logger,
      meta: true,
      msg: this.createErrorLogMessage.bind(this),
      requestWhitelist: ['url', 'headers', 'method', 'httpVersion', 'originalUrl', 'query', 'body'],
      blacklistedMetaFields: ['error', 'exception', 'process', 'os', 'trace', '_readableState']
    }));
  }

  createErrorLogMessage(req, res, err) {
    const responseTime = res.responseTime || 0;
    const statusCode = res.statusCode;
    
    const errorDetails = {
      message: err.message,
      stack: err.stack,
      type: err.name,
      code: err.code,
      status: statusCode,
      request: this.getRequestInfo(req, res),
      response: {
        statusCode,
        responseTime
      }
    };

    console.error('Error Details:', errorDetails);
    this.logger.error('Error Details:', errorDetails);

    return `ERROR ${req.method.padEnd(6)} ${statusCode} ${req.url.padEnd(30)} ${responseTime}ms\nMessage: ${err.message}\nStack: ${err.stack}\nRequest Body: ${JSON.stringify(req.body)}`;
  }

  setupRoutes() {
    const upload = this.fileUploader.createUploader();
    this.setupHealthRoutes();
    this.setupMainRoutes(upload);
    this.setupStaticRoutes();
  }

  setupHealthRoutes() {
    this.app.get('/health', (_, res) => res.json({ status: 'healthy' }));
    this.app.get('/health-db', asyncHandler(async (_, res) => {
      try {
        await this.prisma.$queryRaw`SELECT 1`;
        res.json({ status: 'healthy' });
      } catch (err) {
        this.logger.error('Database health check failed:', err);
        res.status(500).json({ status: 'unhealthy', error: err.message });
      }
    }));
  }

  setupMainRoutes(upload) {
    const { ensureAuthenticated, forwardAuthenticated } = require('./middleware/auth');
    const { auth, profile, micropost, system } = this.controllers;

    // Public routes
    this.app.get('/', (req, res) => {
      res.render('index', {
        title: 'ホーム',
        path: req.path
      });
    });

    // Auth routes
    this.app.get('/auth/signup', forwardAuthenticated, (req, res) => auth.getSignupPage(req, res));
    this.app.post('/auth/signup', forwardAuthenticated, asyncHandler((req, res) => auth.signup(req, res)));
    this.app.get('/auth/login', forwardAuthenticated, (req, res) => auth.getLoginPage(req, res));
    this.app.post('/auth/login', forwardAuthenticated, asyncHandler((req, res) => auth.login(req, res)));
    this.app.get('/auth/logout', ensureAuthenticated, asyncHandler((req, res) => auth.logout(req, res)));

    // Protected routes
    this.app.get('/profile/:id', ensureAuthenticated, asyncHandler((req, res) => profile.show(req, res)));
    this.app.get('/profile/:id/edit', ensureAuthenticated, asyncHandler((req, res) => profile.getEditPage(req, res)));
    this.app.post('/profile/:id/edit', ensureAuthenticated, asyncHandler((req, res) => profile.update(req, res)));
    this.app.get('/system-status', ensureAuthenticated, asyncHandler((req, res) => system.getStatus(req, res)));
    this.app.get('/microposts', ensureAuthenticated, asyncHandler((req, res) => micropost.index(req, res)));
    this.app.post('/microposts', ensureAuthenticated, upload.single('image'), asyncHandler((req, res) => micropost.create(req, res)));
  }

  setupStaticRoutes() {
    if (!this.storageConfig.isEnabled()) {
      this.app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
    }
    this.app.use('/css', express.static(path.join(__dirname, 'public/css')));
  }

  setupErrorHandler() {
    this.app.use((err, req, res, next) => this.errorHandler.handle(err, req, res, next));
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