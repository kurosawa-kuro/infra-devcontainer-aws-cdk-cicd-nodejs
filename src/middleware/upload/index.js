const busboy = require('busboy');
const multer = require('multer');
const { S3Client } = require('@aws-sdk/client-s3');
const multerS3 = require('multer-s3');
const path = require('path');
const fs = require('fs');

// ストレージ設定を管理するクラス
class StorageConfig {
  constructor() {
    this.config = {
      region: process.env.AWS_REGION,
      bucket: process.env.STORAGE_S3_BUCKET,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      },
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
    return process.env.USE_S3 === 'true';
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
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
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

// マルチパートフォームデータを処理するミドルウェア
function createMultipartMiddleware(fileUploader) {
  return [
    // マルチパートデータのパース
    (req, res, next) => {
      if (!req.is('multipart/form-data')) return next();

      const bb = busboy({ headers: req.headers });
      const fields = {};
      let fileCount = 0;

      bb.on('file', (name, file, info) => {
        fileCount++;
        file.resume();
      });

      bb.on('field', (name, val, info) => {
        fields[name] = val;
      });

      bb.on('close', () => {
        req.body = fields;
        next();
      });

      bb.on('error', (err) => {
        console.error('Busboy error:', err);
        next(new Error('ファイルアップロードでエラーが発生しました'));
      });

      req.pipe(bb).on('error', (err) => {
        console.error('Pipe error:', err);
        next(new Error('ファイルアップロードでエラーが発生しました'));
      });
    },

    // CSRFチェック
    (req, res, next) => {
      const token = req.body?._csrf || req.headers['x-csrf-token'];
      if (!token || token !== req.cookies['XSRF-TOKEN']) {
        return res.status(403).json({
          error: 'Invalid CSRF token',
          message: 'セキュリティトークンが無効です'
        });
      }
      next();
    },

    // ファイルアップロード
    (req, res, next) => {
      if (!req.files?.image) return next();
      
      const upload = fileUploader.getUploader().single('image');
      upload(req, res, (err) => {
        if (err) {
          console.error('File upload error:', err);
          return next(new Error('ファイルアップロードに失敗しました'));
        }
        next();
      });
    }
  ];
}

module.exports = {
  StorageConfig,
  FileUploader,
  createMultipartMiddleware
}; 