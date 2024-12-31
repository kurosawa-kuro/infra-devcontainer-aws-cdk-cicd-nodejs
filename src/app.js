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
  constructor(uploadLimits) {
    this.uploadLimits = uploadLimits;
  }

  handle(err, req, res, next) {
    console.error('Application Error:', err);
    
    if (err instanceof multer.MulterError) {
      return this.handleMulterError(err, res);
    }

    return this.handleGeneralError(err, res);
  }

  handleMulterError(err, res) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        error: `ファイルサイズが大きすぎます。${this.uploadLimits.fileSize / (1024 * 1024)}MB以下にしてください。` 
      });
    }
    return res.status(400).json({ error: 'ファイルアップロードエラー' });
  }

  handleGeneralError(err, res) {
    res.status(500).json({ 
      error: process.env.NODE_ENV === 'production' 
        ? 'サーバーエラーが発生しました' 
        : err.message 
    });
  }
}

// コントローラークラス
class AuthController {
  constructor(authService) {
    this.authService = authService;
  }

  getSignupPage(req, res) {
    res.render('auth/signup', { title: 'ユーザー登録', path: req.path });
  }

  async signup(req, res) {
    await this.authService.signup(req.body);
    res.redirect('/auth/login');
  }

  getLoginPage(req, res) {
    res.render('auth/login', { title: 'ログイン', path: req.path });
  }

  async login(req, res) {
    await this.authService.login(req.body);
    res.redirect('/');
  }

  async logout(req, res) {
    await this.authService.logout(req);
    res.redirect('/');
  }
}

class ProfileController {
  constructor(profileService) {
    this.profileService = profileService;
  }

  async show(req, res) {
    const user = await this.profileService.getUserProfile(req.params.id);
    res.render('profile/show', {
      title: 'プロフィール',
      path: req.path,
      user
    });
  }

  async getEditPage(req, res) {
    const user = await this.profileService.getUserProfile(req.params.id);
    res.render('profile/edit', {
      title: 'プロフィール編集',
      path: req.path,
      user
    });
  }

  async update(req, res) {
    await this.profileService.updateProfile(req.params.id, req.body);
    res.redirect(`/profile/${req.params.id}`);
  }
}

class MicropostController {
  constructor(micropostService, fileUploader) {
    this.micropostService = micropostService;
    this.fileUploader = fileUploader;
  }

  async index(req, res) {
    const microposts = await this.micropostService.getAllMicroposts();
    res.render('microposts', { 
      microposts,
      title: '投稿一覧',
      path: req.path
    });
  }

  async create(req, res) {
    try {
      const { title } = req.body;
      if (!title?.trim()) {
        return res.status(400).json({ error: '投稿内容を入力してください' });
      }

      const imageUrl = this.fileUploader.generateFileUrl(req.file);
      await this.micropostService.createMicropost(title.trim(), imageUrl);
      res.redirect('/microposts');
    } catch (error) {
      console.error('File upload error:', error);
      res.status(500).json({ 
        error: 'ファイルアップロードに失敗しました',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
}

class SystemController {
  constructor(systemService) {
    this.systemService = systemService;
  }

  async getStatus(req, res) {
    const metadata = await this.systemService.getInstanceMetadata();
    res.render('system-status', {
      title: 'システム状態',
      path: req.path,
      metadata
    });
  }
}

// サービスクラス
class AuthService {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async signup(userData) {
    const { email, password } = userData;
    
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

  async login(req, res, next) {
    return new Promise((resolve, reject) => {
      passport.authenticate('local', (err, user, info) => {
        if (err) {
          return reject(err);
        }
        if (!user) {
          return reject(new Error(info.message));
        }
        req.logIn(user, (err) => {
          if (err) {
            return reject(err);
          }
          resolve(user);
        });
      })(req, res, next);
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
    this.errorHandler = new ErrorHandler(this.storageConfig.getUploadLimits());

    // Initialize Passport
    require('./config/passport')(passport);

    // サービスの初期化
    this.authService = new AuthService(this.prisma);
    this.profileService = new ProfileService(this.prisma);
    this.micropostService = new MicropostService(this.prisma);
    this.systemService = new SystemService();

    // コントローラーの初期化
    this.authController = new AuthController(this.authService);
    this.profileController = new ProfileController(this.profileService);
    this.micropostController = new MicropostController(this.micropostService, this.fileUploader);
    this.systemController = new SystemController(this.systemService);
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
      meta: false,
      msg: (req, res) => {
        const responseTime = res.responseTime || 0;
        const statusCode = res.statusCode;
        const statusColor = statusCode >= 500 ? '\x1b[31m' : // red
                           statusCode >= 400 ? '\x1b[33m' : // yellow
                           statusCode >= 300 ? '\x1b[36m' : // cyan
                           '\x1b[32m'; // green
        const reset = '\x1b[0m';
        return `${req.method.padEnd(6)} ${statusColor}${statusCode}${reset} ${req.url.padEnd(30)} ${responseTime}ms`;
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
      meta: false,
      msg: (req, res, err) => {
        const responseTime = res.responseTime || 0;
        const statusCode = res.statusCode;
        return `ERROR ${req.method.padEnd(6)} ${statusCode} ${req.url.padEnd(30)} ${responseTime}ms - ${err.message}`;
      }
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
      try {
        await this.authController.signup(req, res);
        req.flash('success', 'ユーザー登録が完了しました。ログインしてください。');
        res.redirect('/auth/login');
      } catch (error) {
        req.flash('error', error.message);
        res.redirect('/auth/signup');
      }
    }));

    this.app.get('/auth/login', forwardAuthenticated, (req, res) => this.authController.getLoginPage(req, res));
    this.app.post('/auth/login', forwardAuthenticated, asyncHandler(async (req, res) => {
      try {
        await this.authController.login(req, res);
        req.flash('success', 'ログインしました');
        res.redirect('/');
      } catch (error) {
        req.flash('error', error.message);
        res.redirect('/auth/login');
      }
    }));

    this.app.get('/auth/logout', ensureAuthenticated, asyncHandler(async (req, res) => {
      await this.authController.logout(req, res);
      req.flash('success', 'ログアウトしました');
      res.redirect('/auth/login');
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