const express = require('express');
const asyncHandler = require('express-async-handler');
const winston = require('winston');
const expressWinston = require('express-winston');
const path = require('path');
const multer = require('multer');
const { PrismaClient } = require('@prisma/client');
const { S3Client } = require('@aws-sdk/client-s3');
const multerS3 = require('multer-s3');
const fs = require('fs');
const axios = require('axios');
require('dotenv').config();

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
        fileSize: 5 * 1024 * 1024, // 5MB
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

// メインのアプリケーションクラス
class Application {
  constructor() {
    this.app = express();
    this.prisma = new PrismaClient();
    this.port = process.env.APP_PORT || 8080;
    
    // Winstonロガーの設定
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple(),
        winston.format.printf(({ level, message }) => {
          return `${level}: ${message}`;
        })
      ),
      transports: [
        new winston.transports.Console()
      ]
    });
    
    this.storageConfig = new StorageConfig();
    this.fileUploader = new FileUploader(this.storageConfig);
    this.errorHandler = new ErrorHandler(this.storageConfig.getUploadLimits());
  }

  setupMiddleware() {
    // リクエストロギング
    this.app.use(expressWinston.logger({
      winstonInstance: this.logger,
      meta: false,
      msg: (req, res) => {
        const responseTime = res.responseTime || 0;
        return `${req.method.padEnd(6)} ${req.url.padEnd(30)} ${responseTime}ms`;
      },
      expressFormat: false,
      colorize: true,
      ignoreRoute: (req) => {
        return req.url === '/health' || req.url === '/health-db';
      }
    }));

    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.set('view engine', 'ejs');
    this.app.set('views', path.join(__dirname, 'views'));

    // エラーロギング
    this.app.use(expressWinston.errorLogger({
      winstonInstance: this.logger,
      meta: false,
      msg: (req, res, err) => {
        const responseTime = res.responseTime || 0;
        return `${req.method.padEnd(6)} ${req.url.padEnd(30)} ${responseTime}ms - ${err.message}`;
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
    this.app.get('/', asyncHandler(async (_, res) => {
      const microposts = await this.prisma.micropost.findMany({
        orderBy: { createdAt: 'desc' }
      });
      res.render('index', { microposts });
    }));

    this.app.post('/microposts', upload.single('image'), asyncHandler(async (req, res) => {
      try {
        const { title } = req.body;
        if (!title?.trim()) {
          return res.status(400).json({ error: '投稿内容を入力してください' });
        }

        const imageUrl = this.fileUploader.generateFileUrl(req.file);

        await this.prisma.micropost.create({
          data: { 
            title: title.trim(),
            imageUrl
          }
        });

        res.redirect('/');
      } catch (error) {
        console.error('File upload error:', error);
        res.status(500).json({ 
          error: 'ファイルアップロードに失敗しました',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
      }
    }));
  }

  setupStaticRoutes() {
    if (!this.storageConfig.isEnabled()) {
      this.app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
    }
  }

  setupErrorHandler() {
    this.app.use((err, req, res, next) => this.errorHandler.handle(err, req, res, next));
  }

  async getInstanceMetadata() {
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
        publicIp: '13.114.210.249',
        privateIp: 'localhost'
      };
    }
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