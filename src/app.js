const express = require('express');
const asyncHandler = require('express-async-handler');
const morgan = require('morgan');
const path = require('path');
const multer = require('multer');
const { PrismaClient } = require('@prisma/client');
const { S3Client } = require('@aws-sdk/client-s3');
const multerS3 = require('multer-s3');
const fs = require('fs');
require('dotenv').config();

class Application {
  constructor() {
    this.app = express();
    this.prisma = new PrismaClient();
    this.port = process.env.PORT || 3000;
    
    // S3の設定
    this.s3Config = {
      region: process.env.AWS_REGION,
      bucket: process.env.AWS_BUCKET,
      cloudfront: {
        url: process.env.AWS_CLOUDFRONT_URL,
        distributionId: process.env.AWS_CLOUDFRONT_DISTRIBUTION_ID
      },
      uploadLimits: {
        fileSize: 5 * 1024 * 1024, // 5MB
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif']
      }
    };

    // S3クライアントの初期化
    if (this.isS3Configured()) {
      this.s3 = new S3Client({
        region: this.s3Config.region,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
      });
    }
  }

  // S3の設定が完了しているか確認
  isS3Configured() {
    return this.s3Config.region && 
           process.env.AWS_ACCESS_KEY_ID && 
           process.env.AWS_SECRET_ACCESS_KEY &&
           this.s3Config.bucket;
  }

  // ファイルアップロードの設定
  createUploader() {
    const fileFilter = (req, file, cb) => {
      if (this.s3Config.uploadLimits.allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error(`対応していないファイル形式です。対応形式: ${this.s3Config.uploadLimits.allowedMimeTypes.join(', ')}`));
      }
    };

    if (this.isS3Configured()) {
      console.log('Using S3 storage with CloudFront');
      return multer({
        storage: multerS3({
          s3: this.s3,
          bucket: this.s3Config.bucket,
          contentType: multerS3.AUTO_CONTENT_TYPE,
          metadata: (req, file, cb) => {
            cb(null, {
              fieldName: file.fieldname,
              contentType: file.mimetype,
              uploadedAt: new Date().toISOString()
            });
          },
          key: (req, file, cb) => {
            const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
            const fileExtension = path.extname(file.originalname);
            const fileName = `uploads/${uniqueSuffix}${fileExtension}`;
            cb(null, fileName);
          }
        }),
        limits: {
          fileSize: this.s3Config.uploadLimits.fileSize
        },
        fileFilter
      });
    } else {
      console.log('Using local storage for uploads');
      const uploadDir = path.join(__dirname, '..', 'uploads');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      
      return multer({
        storage: multer.diskStorage({
          destination: (req, file, cb) => cb(null, uploadDir),
          filename: (req, file, cb) => {
            const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
            const fileExtension = path.extname(file.originalname);
            cb(null, `${uniqueSuffix}${fileExtension}`);
          }
        }),
        limits: {
          fileSize: this.s3Config.uploadLimits.fileSize
        },
        fileFilter
      });
    }
  }

  // ミドルウェアの設定
  setupMiddleware() {
    const logFormat = ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :response-time ms';
    this.app.use(morgan(logFormat));
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.set('view engine', 'ejs');
    this.app.set('views', path.join(__dirname, 'views'));
  }

  // ルートハンドラーの設定
  setupRoutes() {
    const upload = this.createUploader();

    // ヘルスチェック
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

    // メインページ
    this.app.get('/', asyncHandler(async (_, res) => {
      const microposts = await this.prisma.micropost.findMany({
        orderBy: { createdAt: 'desc' }
      });
      res.render('index', { microposts });
    }));

    // 投稿作成
    this.app.post('/microposts', upload.single('image'), asyncHandler(async (req, res) => {
      try {
        const { title } = req.body;
        if (!title?.trim()) {
          return res.status(400).json({ error: '投稿内容を入力してください' });
        }

        let imageUrl = null;
        if (req.file) {
          imageUrl = this.isS3Configured() 
            ? `${this.s3Config.cloudfront.url}/${req.file.key}`
            : `/uploads/${req.file.filename}`;
        }

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

    // ローカルアップロードの場合の静的ファイル提供
    if (!this.isS3Configured()) {
      this.app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
    }
  }

  // エラーハンドラー
  setupErrorHandler() {
    this.app.use((err, req, res, next) => {
      console.error('Application Error:', err);
      
      // multerのエラーハンドリング
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ 
            error: `ファイルサイズが大きすぎます。${this.s3Config.uploadLimits.fileSize / (1024 * 1024)}MB以下にしてください。` 
          });
        }
        return res.status(400).json({ error: 'ファイルアップロードエラー' });
      }

      // 一般的なエラーハンドリング
      res.status(500).json({ 
        error: process.env.NODE_ENV === 'production' 
          ? 'サーバーエラーが発生しました' 
          : err.message 
      });
    });
  }

  // アプリケーションの起動
  async start() {
    try {
      this.setupMiddleware();
      this.setupRoutes();
      this.setupErrorHandler();

      if (process.env.NODE_ENV !== 'test') {
        const host = '0.0.0.0';
        this.app.listen(this.port, host, () => {
          console.log('\n=== Server URLs ===');
          console.log(`Local:   http://localhost:${this.port}`);
          console.log(`Public:  http://${process.env.EC2_PUBLIC_IP || 'YOUR_EC2_PUBLIC_IP'}:${this.port}`);
          console.log(`Private: http://${process.env.EC2_PRIVATE_IP || 'YOUR_EC2_PRIVATE_IP'}:${this.port}`);
          console.log(`\nStorage: ${this.isS3Configured() ? 'S3' : 'Local'}`);
        });
      }
    } catch (err) {
      console.error('Application startup error:', err);
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