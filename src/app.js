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
    const isS3Enabled = process.env.STORAGE_PROVIDER !== 'local';
    const hasRequiredConfig = this.config.region && 
           process.env.STORAGE_S3_ACCESS_KEY && 
           process.env.STORAGE_S3_SECRET_KEY &&
           this.config.bucket;
    
    return isS3Enabled && hasRequiredConfig;
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
      const fileName = `uploads/${uniqueSuffix}${fileExtension}`;
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

  handle(err, req, res, next) {
    console.error('Application Error:', err);
    
    if (err instanceof multer.MulterError) {
      return this.handleMulterError(err, req, res);
    }

    return this.handleGeneralError(err, req, res);
  }

  handleMulterError(err, req, res) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      const error = `ファイルサイズが大きすぎます。${this.uploadLimits.fileSize / (1024 * 1024)}MB以下にしてください。`;
      this.logError('Multer Error', error, { code: err.code, field: err.field });
      return this.sendErrorResponse(req, res, 400, error);
    }
    
    this.logError('Multer Error', err);
    return this.sendErrorResponse(req, res, 400, 'ファイルアップロードエラー', {
      code: err.code,
      field: err.field,
      message: err.message
    });
  }

  handleGeneralError(err, req, res) {
    this.logError('General Error', err);
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? 'サーバーエラーが発生しました' 
      : err.message;
    
    const details = process.env.NODE_ENV !== 'production' ? {
      stack: err.stack,
      details: err.details || {}
    } : undefined;

    return this.sendErrorResponse(req, res, err.status || 500, errorMessage, details);
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

  // 共通のエラーログ記録関数
  logError(type, error, additionalInfo = {}) {
    const errorInfo = {
      message: error.message || error,
      stack: error.stack,
      ...additionalInfo
    };

    console.error(`${type}:`, errorInfo);
    if (this.logger) {
      this.logger.error(`${type}:`, errorInfo);
    }
  }

  // 共通のバリデーションエラー処理
  handleValidationError(req, res, message) {
    return this.sendErrorResponse(req, res, 400, message);
  }

  // 共通の認証エラー処理
  handleAuthError(req, res, message = '認証が必要です') {
    return this.sendErrorResponse(req, res, 401, message);
  }

  // 共通の権限エラー処理
  handlePermissionError(req, res, message = '権限がありません') {
    return this.sendErrorResponse(req, res, 403, message);
  }

  // 共通の「見つかりません」エラー処理
  handleNotFoundError(req, res, message = 'リソースが見つかりません') {
    return this.sendErrorResponse(req, res, 404, message);
  }
}

// コントローラークラスの基底クラス
class BaseController {
  constructor(errorHandler) {
    this.errorHandler = errorHandler;
  }

  // 成功時のレスポンス送信
  sendSuccessResponse(req, res, message, redirectUrl) {
    const isApiRequest = req.xhr || req.headers.accept?.includes('application/json');
    
    if (isApiRequest) {
      return res.json({ success: true, message });
    } else {
      if (message) {
        req.flash('success', message);
      }
      return res.redirect(redirectUrl);
    }
  }
}

// 各コントローラーを基底クラスを継承するように修正
class AuthController extends BaseController {
  constructor(authService, errorHandler) {
    super(errorHandler);
    this.authService = authService;
  }

  getSignupPage(req, res) {
    try {
      res.render('auth/signup', { 
        title: 'ユーザー登録',
        path: req.path
      });
    } catch (error) {
      return this.errorHandler.handleGeneralError(error, req, res);
    }
  }

  getLoginPage(req, res) {
    try {
      res.render('auth/login', { 
        title: 'ログイン',
        path: req.path
      });
    } catch (error) {
      return this.errorHandler.handleGeneralError(error, req, res);
    }
  }

  async signup(req, res) {
    try {
      await this.authService.signup(req.body);
      return this.sendSuccessResponse(req, res, 'ユーザー登録が完了しました。ログインしてください。', '/auth/login');
    } catch (error) {
      return this.errorHandler.handleValidationError(req, res, error.message);
    }
  }

  async login(req, res) {
    try {
      await this.authService.login(req, res);
      return this.sendSuccessResponse(req, res, 'ログインしました', '/');
    } catch (error) {
      return this.errorHandler.handleAuthError(req, res, error.message);
    }
  }

  async logout(req, res) {
    try {
      await this.authService.logout(req);
      return this.sendSuccessResponse(req, res, 'ログアウトしました', '/auth/login');
    } catch (error) {
      return this.errorHandler.handleGeneralError(error, req, res);
    }
  }
}

class MicropostController extends BaseController {
  constructor(micropostService, fileUploader, errorHandler) {
    super(errorHandler);
    this.micropostService = micropostService;
    this.fileUploader = fileUploader;
  }

  async index(req, res) {
    try {
      const microposts = await this.micropostService.getAllMicroposts();
      res.render('microposts', { 
        microposts,
        title: '投稿一覧',
        path: req.path
      });
    } catch (error) {
      console.error('Micropost index error:', {
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
        userId: req.user?.id,
        requestPath: req.path,
        requestMethod: req.method
      });
      return this.errorHandler.handleGeneralError(error, req, res);
    }
  }

  async create(req, res) {
    try {
      const { title } = req.body;
      if (!title?.trim()) {
        const validationError = new Error('投稿内容を入力してください');
        validationError.name = 'ValidationError';
        validationError.code = 'EMPTY_CONTENT';
        validationError.details = {
          field: 'title',
          value: title,
          constraint: 'required',
          userId: req.user?.id,
          timestamp: new Date().toISOString()
        };
        console.error('Micropost validation error:', {
          error: validationError.message,
          stack: validationError.stack,
          details: validationError.details,
          requestBody: req.body,
          requestPath: req.path,
          requestMethod: req.method
        });
        throw validationError;
      }

      const imageUrl = this.fileUploader.generateFileUrl(req.file);
      await this.micropostService.createMicropost(title.trim(), imageUrl);
      return this.sendSuccessResponse(req, res, '投稿が完了しました', '/microposts');
    } catch (error) {
      const errorDetails = {
        error: error.message,
        name: error.name,
        code: error.code,
        stack: error.stack,
        details: error.details || {},
        timestamp: new Date().toISOString(),
        userId: req.user?.id,
        requestBody: req.body,
        file: req.file,
        requestPath: req.path,
        requestMethod: req.method
      };
      console.error('Micropost creation error:', errorDetails);
      
      if (error.name === 'ValidationError') {
        return this.errorHandler.handleValidationError(req, res, error.message);
      }
      return this.errorHandler.handleGeneralError(error, req, res);
    }
  }
}

class ProfileController extends BaseController {
  constructor(profileService, errorHandler) {
    super(errorHandler);
    this.profileService = profileService;
  }

  async show(req, res) {
    try {
      const user = await this.profileService.getUserProfile(req.params.id);
      if (!user) {
        return this.errorHandler.handleNotFoundError(req, res, 'ユーザーが見つかりません');
      }
      res.render('profile/show', {
        title: 'プロフィール',
        path: req.path,
        user
      });
    } catch (error) {
      return this.errorHandler.handleGeneralError(error, req, res);
    }
  }

  async getEditPage(req, res) {
    try {
      const user = await this.profileService.getUserProfile(req.params.id);
      if (!user) {
        return this.errorHandler.handleNotFoundError(req, res, 'ユーザーが見つかりません');
      }
      res.render('profile/edit', {
        title: 'プロフィール編集',
        path: req.path,
        user
      });
    } catch (error) {
      return this.errorHandler.handleGeneralError(error, req, res);
    }
  }

  async update(req, res) {
    try {
      await this.profileService.updateProfile(req.params.id, req.body);
      return this.sendSuccessResponse(req, res, 'プロフィールを更新しました', `/profile/${req.params.id}`);
    } catch (error) {
      return this.errorHandler.handleGeneralError(error, req, res);
    }
  }
}

class SystemController {
  constructor(systemService, errorHandler) {
    this.systemService = systemService;
    this.errorHandler = errorHandler;
  }

  async getStatus(req, res) {
    try {
      const metadata = await this.systemService.getInstanceMetadata();
      res.render('system-status', {
        title: 'システム状態',
        path: req.path,
        metadata
      });
    } catch (error) {
      return this.errorHandler.handleGeneralError(error, req, res);
    }
  }
}

// サービスクラス
class AuthService {
  constructor(prisma) {
    this.prisma = prisma;
  }

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
    
    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword
      }
    });

    return user;
  }

  async login(req, res) {
    return new Promise((resolve, reject) => {
      passport.authenticate('local', (err, user, info) => {
        if (err) {
          return reject(err);
        }
        if (!user) {
          return reject(new Error(info?.message || 'ログインに失敗しました'));
        }
        req.logIn(user, (err) => {
          if (err) {
            return reject(err);
          }
          resolve(user);
        });
      })(req, res);
    });
  }

  async logout(req) {
    return new Promise((resolve, reject) => {
      req.logout((err) => {
        if (err) {
          return reject(err);
        }
        resolve();
      });
    });
  }
}

class ProfileService {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async getUserProfile(userId) {
    // 実際のアプリケーションではDBからユーザー情報を取得
    return {
      id: userId,
      email: '',
      bio: '',
      createdAt: new Date()
    };
  }

  async updateProfile(userId, profileData) {
    // プロフィール更新ロジックの実装
    return null;
  }
}

class MicropostService {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async getAllMicroposts() {
    return this.prisma.micropost.findMany({
      orderBy: { createdAt: 'desc' }
    });
  }

  async createMicropost(title, imageUrl) {
    return this.prisma.micropost.create({
      data: { title, imageUrl }
    });
  }
}

class SystemService {
  constructor() {}

  async getInstanceMetadata() {
    if (process.env.NODE_ENV === 'development') {
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
      console.warn('Failed to fetch EC2 metadata:', error.message);
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
    this.port = process.env.APP_PORT || 8080;
    
    const loggingSystem = new LoggingSystem();
    this.logger = loggingSystem.getLogger();
    
    this.storageConfig = new StorageConfig();
    this.fileUploader = new FileUploader(this.storageConfig);
    this.errorHandler = new ErrorHandler(this.storageConfig.getUploadLimits(), this.logger);

    // Initialize Passport
    require('./config/passport')(passport);

    // サービスの初期化
    this.authService = new AuthService(this.prisma);
    this.profileService = new ProfileService(this.prisma);
    this.micropostService = new MicropostService(this.prisma);
    this.systemService = new SystemService();

    // コントローラーの初期化
    this.authController = new AuthController(this.authService, this.errorHandler);
    this.profileController = new ProfileController(this.profileService, this.errorHandler);
    this.micropostController = new MicropostController(this.micropostService, this.fileUploader, this.errorHandler);
    this.systemController = new SystemController(this.systemService, this.errorHandler);
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
      msg: (req, res) => {
        const responseTime = res.responseTime || 0;
        const statusCode = res.statusCode;
        const statusColor = statusCode >= 500 ? '\x1b[31m' : // red
                           statusCode >= 400 ? '\x1b[33m' : // yellow
                           statusCode >= 300 ? '\x1b[36m' : // cyan
                           '\x1b[32m'; // green
        const reset = '\x1b[0m';
        
        // エラーメッセージの詳細化
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

        // リクエストの詳細情報を追加
        const requestInfo = {
          method: req.method,
          url: req.url,
          params: req.params,
          query: req.query,
          body: req.body,
          headers: req.headers,
          statusCode,
          responseTime
        };

        // エラー時は詳細情報をログに記録
        if (statusCode >= 400) {
          console.error('Request Details:', requestInfo);
          this.logger.error('Request Details:', requestInfo);
        }

        return `${req.method.padEnd(6)} ${statusColor}${statusCode}${reset} ${req.url.padEnd(30)} ${responseTime}ms${errorInfo}`;
      },
      expressFormat: false,
      colorize: true,
      ignoreRoute: (req) => req.url === '/health' || req.url === '/health-db'
    }));
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
      secret: process.env.SESSION_SECRET || 'your-session-secret',
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      }
    }));
    this.app.use(passport.initialize());
    this.app.use(passport.session());
    this.app.use(flash());

    // Make user available to all views
    this.app.use((req, res, next) => {
      res.locals.user = req.user;
      res.locals.error = req.flash('error');
      res.locals.success = req.flash('success');
      next();
    });
  }

  setupErrorLogging() {
    this.app.use(expressWinston.errorLogger({
      winstonInstance: this.logger,
      meta: true,
      msg: (req, res, err) => {
        const responseTime = res.responseTime || 0;
        const statusCode = res.statusCode;
        
        // エラーの詳細情報を収集
        const errorDetails = {
          message: err.message,
          stack: err.stack,
          type: err.name,
          code: err.code,
          status: statusCode,
          request: {
            method: req.method,
            url: req.url,
            params: req.params,
            query: req.query,
            body: req.body,
            headers: req.headers
          },
          response: {
            statusCode,
            responseTime
          }
        };

        // エラー詳細をログに記録
        console.error('Error Details:', errorDetails);
        this.logger.error('Error Details:', errorDetails);

        return `ERROR ${req.method.padEnd(6)} ${statusCode} ${req.url.padEnd(30)} ${responseTime}ms\nMessage: ${err.message}\nStack: ${err.stack}\nRequest Body: ${JSON.stringify(req.body)}`;
      },
      requestWhitelist: ['url', 'headers', 'method', 'httpVersion', 'originalUrl', 'query', 'body'],
      blacklistedMetaFields: ['error', 'exception', 'process', 'os', 'trace', '_readableState']
    }));
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
        console.error('Database health check failed:', err);
        res.status(500).json({ status: 'unhealthy', error: err.message });
      }
    }));
  }

  setupMainRoutes(upload) {
    const { ensureAuthenticated, forwardAuthenticated } = require('./middleware/auth');

    this.app.get('/', (req, res) => {
      res.render('index', {
        title: 'ホーム',
        path: req.path
      });
    });

    // Auth routes
    this.app.get('/auth/signup', forwardAuthenticated, (req, res) => this.authController.getSignupPage(req, res));
    this.app.post('/auth/signup', forwardAuthenticated, asyncHandler(async (req, res) => {
      await this.authController.signup(req, res);
    }));

    this.app.get('/auth/login', forwardAuthenticated, (req, res) => this.authController.getLoginPage(req, res));
    this.app.post('/auth/login', forwardAuthenticated, asyncHandler(async (req, res) => {
      await this.authController.login(req, res);
    }));

    this.app.get('/auth/logout', ensureAuthenticated, asyncHandler(async (req, res) => {
      await this.authController.logout(req, res);
    }));

    // Profile routes (protected)
    this.app.get('/profile/:id', ensureAuthenticated, asyncHandler((req, res) => this.profileController.show(req, res)));
    this.app.get('/profile/:id/edit', ensureAuthenticated, asyncHandler((req, res) => this.profileController.getEditPage(req, res)));
    this.app.post('/profile/:id/edit', ensureAuthenticated, asyncHandler((req, res) => this.profileController.update(req, res)));

    // System routes (protected)
    this.app.get('/system-status', ensureAuthenticated, asyncHandler((req, res) => this.systemController.getStatus(req, res)));

    // Micropost routes (protected)
    this.app.get('/microposts', ensureAuthenticated, asyncHandler((req, res) => this.micropostController.index(req, res)));
    this.app.post('/microposts', ensureAuthenticated, upload.single('image'), asyncHandler((req, res) => this.micropostController.create(req, res)));
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

  async getInstanceMetadata() {
    return this.systemService.getInstanceMetadata();
  }

  async start() {
    try {
      this.setupMiddleware();
      this.setupRoutes();
      this.setupErrorHandler();

      if (process.env.APP_ENV !== 'test') {
        const host = process.env.APP_HOST || '0.0.0.0';
        const { publicIp, privateIp } = await this.getInstanceMetadata();
        
        this.app.listen(this.port, host, () => {
          console.log('\n=== Server Information ===');
          console.log(`Environment: ${process.env.APP_ENV}`);
          console.log(`Storage:     ${this.storageConfig.isEnabled() ? 'S3' : 'Local'}`);
          console.log('\n=== Access URLs ===');
          console.log(`Local:       http://localhost:${this.port}`);
          console.log(`Public:      http://${publicIp}:${this.port}`);
          console.log(`Private:     http://${privateIp}:${this.port}`);
          console.log('\n=== Server is ready ===\n');
        });
      }
    } catch (err) {
      this.logger.error('Application startup error:', err);
      process.exit(1);
    }
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