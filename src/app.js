const express = require('express');
const asyncHandler = require('express-async-handler');
const morgan = require('morgan');
const path = require('path');
const multer = require('multer');
const { PrismaClient } = require('@prisma/client');
const { S3Client } = require('@aws-sdk/client-s3');
const multerS3 = require('multer-s3');
require('dotenv').config();

class FileHandler {
  static validateFileType(mimetype) {
    return ['image/jpeg', 'image/png', 'image/gif'].includes(mimetype);
  }

  static createS3Storage() {
    const s3 = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    });

    return multerS3({
      s3,
      bucket: process.env.AWS_BUCKET_NAME,
      contentType: multerS3.AUTO_CONTENT_TYPE,
      metadata: (req, file, cb) => cb(null, { fieldName: file.fieldname }),
      key: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
      }
    });
  }

  static createUploader() {
    return multer({
      storage: this.createS3Storage(),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
      fileFilter: (req, file, cb) => {
        this.validateFileType(file.mimetype) 
          ? cb(null, true)
          : cb(new Error('Invalid file type. Only JPEG, PNG and GIF are allowed.'));
      }
    });
  }
}

class MicropostService {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async getAllMicroposts() {
    return await this.prisma.micropost.findMany({
      orderBy: { createdAt: 'desc' }
    });
  }

  async createMicropost(title, imageUrl) {
    return await this.prisma.micropost.create({
      data: { title, imageUrl }
    });
  }
}

class ApiController {
  constructor(micropostService) {
    this.micropostService = micropostService;
  }

  checkHealth = asyncHandler(async (req, res) => {
    res.json({ status: 'healthy' });
  });

  checkDbHealth = asyncHandler(async (req, res) => {
    try {
      await this.micropostService.prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'healthy' });
    } catch (err) {
      console.error('Database health check failed:', err);
      res.status(500).json({ status: 'unhealthy', error: err.message });
    }
  });

  getMicroposts = asyncHandler(async (req, res) => {
    const microposts = await this.micropostService.getAllMicroposts();
    res.json(microposts);
  });

  createMicropost = asyncHandler(async (req, res) => {
    const { title } = req.body;
    const imageUrl = req.file?.location;
    
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const micropost = await this.micropostService.createMicropost(title, imageUrl);
    res.status(201).json(micropost);
  });
}

class WebController {
  constructor(micropostService) {
    this.micropostService = micropostService;
  }

  showIndex = asyncHandler(async (req, res) => {
    const microposts = await this.micropostService.getAllMicroposts();
    res.render('index', { microposts });
  });

  createMicropost = asyncHandler(async (req, res) => {
    const { title } = req.body;
    const imageUrl = req.file?.location;
    
    await this.micropostService.createMicropost(title, imageUrl);
    res.redirect('/');
  });
}

class Application {
  constructor() {
    this.app = express();
    this.prisma = new PrismaClient();
    this.port = process.env.PORT || 3001;
    this.uploader = FileHandler.createUploader();
  }

  setupMiddleware() {
    // ロギング設定
    const logFormat = ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :response-time ms :request-body';
    morgan.token('request-body', (req) => JSON.stringify(req.body));
    this.app.use(morgan(logFormat));

    // 基本設定
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.set('view engine', 'ejs');
    this.app.set('views', path.join(__dirname, 'views'));
  }

  setupRoutes() {
    const micropostService = new MicropostService(this.prisma);
    const apiController = new ApiController(micropostService);
    const webController = new WebController(micropostService);

    // APIルート
    this.app.get('/health', apiController.checkHealth);
    this.app.get('/health-db', apiController.checkDbHealth);
    this.app.get('/api/microposts', apiController.getMicroposts);
    this.app.post('/api/microposts', this.uploader.single('image'), apiController.createMicropost);

    // Webルート
    this.app.get('/', webController.showIndex);
    this.app.post('/microposts', this.uploader.single('image'), webController.createMicropost);
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
    console.error('アプリケーション起動エラー:', err);
    process.exit(1);
  });

  process.on('beforeExit', async () => {
    await app.cleanup();
  });
}

module.exports = { Application };