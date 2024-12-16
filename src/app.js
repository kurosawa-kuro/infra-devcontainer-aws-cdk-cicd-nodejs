const express = require('express');
const asyncHandler = require('express-async-handler');
const morgan = require('morgan');
const path = require('path');
const multer = require('multer');
const { PrismaClient } = require('@prisma/client');
const { S3Client } = require('@aws-sdk/client-s3');
const multerS3 = require('multer-s3');
require('dotenv').config();

class Application {
  constructor() {
    this.app = express();
    this.prisma = new PrismaClient();
    this.port = process.env.PORT || 3001;
    this.s3 = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    });
  }

  // S3アップローダーの設定
  createUploader() {
    return multer({
      storage: multerS3({
        s3: this.s3,
        bucket: process.env.AWS_BUCKET_NAME,
        contentType: multerS3.AUTO_CONTENT_TYPE,
        metadata: (req, file, cb) => cb(null, { fieldName: file.fieldname }),
        key: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
          cb(null, uniqueSuffix + path.extname(file.originalname));
        }
      }),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
      fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
        allowedTypes.includes(file.mimetype) 
          ? cb(null, true)
          : cb(new Error('画像形式はJPEG、PNG、GIFのみ対応しています'));
      }
    });
  }

  // ミドルウェアの設定
  setupMiddleware() {
    // ロギング設定
    const logFormat = ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :response-time ms';
    this.app.use(morgan(logFormat));

    // 基本設定
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
    this.app.get('/health-db', async (_, res) => {
      try {
        await this.prisma.$queryRaw`SELECT 1`;
        res.json({ status: 'healthy' });
      } catch (err) {
        console.error('Database health check failed:', err);
        res.status(500).json({ status: 'unhealthy', error: err.message });
      }
    });

    // メインページ
    this.app.get('/', asyncHandler(async (_, res) => {
      const microposts = await this.prisma.micropost.findMany({
        orderBy: { createdAt: 'desc' }
      });
      res.render('index', { microposts });
    }));

    // 投稿作成
    this.app.post('/microposts', upload.single('image'), asyncHandler(async (req, res) => {
      const { title } = req.body;
      if (!title?.trim()) {
        return res.status(400).json({ error: '投稿内容を入力してください' });
      }

      await this.prisma.micropost.create({
        data: { 
          title: title.trim(),
          imageUrl: req.file?.location
        }
      });

      res.redirect('/');
    }));
  }

  // エラーハンドラーの設定
  setupErrorHandler() {
    this.app.use((err, req, res, next) => {
      console.error('Application Error:', err);
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

      // テスト環境では自動起動しない
      if (process.env.NODE_ENV !== 'test') {
        this.app.listen(this.port, () => {
          console.log('\n=== Server URLs ===');
          console.log(`Local:   http://localhost:${this.port}`);
          console.log(`Network: http://127.0.0.1:${this.port}`);
        });
      }
    } catch (err) {
      console.error('Application startup error:', err);
      process.exit(1);
    }
  }

  // クリーンアップ処理
  async cleanup() {
    await this.prisma.$disconnect();
  }
}

// アプリケーションの実行
if (require.main === module) {
  const app = new Application();
  app.start();

  // 終了時の処理
  ['SIGINT', 'SIGTERM'].forEach(signal => {
    process.on(signal, async () => {
      console.log(`\nReceived ${signal}, cleaning up...`);
      await app.cleanup();
      process.exit(0);
    });
  });
}

module.exports = { Application };