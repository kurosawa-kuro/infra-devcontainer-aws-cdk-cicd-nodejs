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
    this.uploader = this.setupFileUploader();
  }

  setupFileUploader() {
    const s3 = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    });

    return multer({
      storage: multerS3({
        s3,
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
          : cb(new Error('Invalid file type. Only JPEG, PNG and GIF are allowed.'));
      }
    });
  }

  setupMiddleware() {
    const logFormat = ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :response-time ms :request-body';
    morgan.token('request-body', (req) => JSON.stringify(req.body));
    this.app.use(morgan(logFormat));

    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.set('view engine', 'ejs');
    this.app.set('views', path.join(__dirname, 'views'));
  }

  setupRoutes() {
    // ヘルスチェック
    this.app.get('/health', (req, res) => {
      res.json({ status: 'healthy' });
    });

    this.app.get('/health-db', async (req, res) => {
      try {
        await this.prisma.$queryRaw`SELECT 1`;
        res.json({ status: 'healthy' });
      } catch (err) {
        console.error('Database health check failed:', err);
        res.status(500).json({ status: 'unhealthy', error: err.message });
      }
    });

    // メインページ
    this.app.get('/', asyncHandler(async (req, res) => {
      const microposts = await this.prisma.micropost.findMany({
        orderBy: { createdAt: 'desc' }
      });
      res.render('index', { microposts });
    }));

    // 投稿作成
    this.app.post('/microposts', 
      this.uploader.single('image'),
      asyncHandler(async (req, res) => {
        const { title } = req.body;
        const imageUrl = req.file?.location;
        
        if (!title) {
          return res.status(400).json({ error: 'Title is required' });
        }

        await this.prisma.micropost.create({
          data: { title, imageUrl }
        });

        res.redirect('/');
      })
    );
  }

  setupErrorHandler() {
    this.app.use((err, req, res, next) => {
      console.error(err.stack);
      res.status(500).json({ error: err.message });
    });
  }

  async start() {
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandler();

    this.app.listen(this.port, () => {
      console.log('\n=== Server URLs ===');
      console.log(`Local:   http://localhost:${this.port}`);
      console.log(`Network: http://127.0.0.1:${this.port}`);
    });
  }

  async cleanup() {
    await this.prisma.$disconnect();
  }
}

if (require.main === module) {
  const app = new Application();
  app.start().catch((err) => {
    console.error('Application startup error:', err);
    process.exit(1);
  });

  process.on('beforeExit', async () => {
    await app.cleanup();
  });
}

module.exports = { Application };