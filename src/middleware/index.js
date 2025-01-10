const { logger, middleware: loggingMiddleware } = require('./core/logging');
const { ErrorHandler, middleware: errorMiddleware } = require('./core/error');
const { isAuthenticated, forwardAuthenticated, isAdmin, setupSecurity } = require('./core/security');
const InitializationMiddleware = require('./setup/initialize');

// Combine all middleware functions
const middleware = {
  ...loggingMiddleware,
  ...errorMiddleware,
  notFound: errorMiddleware.notFound,
  error: errorMiddleware.error
};

// Static file serving setup
const setupStaticMiddleware = (app) => {
  const express = require('express');
  const path = require('path');

  if (process.env.STORAGE_PROVIDER !== 's3') {
    app.use('/uploads', express.static(path.join(__dirname, '../public/uploads'), {
      fallthrough: false,
      setHeaders: (res) => {
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Cache-Control', 'public, max-age=31557600');
      }
    }));
  }
  
  app.use('/css', express.static(path.join(__dirname, '../public/css')));
  app.use('/images', express.static(path.join(__dirname, '../public/images')));
};

// Multipart form handling
const createMultipartMiddleware = (fileUploader) => {
  const busboy = require('busboy');
  return [
    // マルチパートデータのパース
    (req, res, next) => {
      if (!req.is('multipart/form-data')) return next();
      
      const bb = busboy({ headers: req.headers });
      const fields = {};
      
      bb.on('file', (name, file) => file.resume());
      bb.on('field', (name, val) => fields[name] = val);
      bb.on('finish', () => {
        req.body = fields;
        next();
      });
      req.pipe(bb);
    },
    // CSRFチェック
    (req, res, next) => {
      if (!req.body?._csrf || req.body._csrf !== req.cookies._csrf) {
        return res.status(403).json({ error: 'Invalid CSRF token' });
      }
      next();
    },
    // ファイルアップロード
    (req, res, next) => {
      if (!req.files?.image) return next();
      fileUploader.getUploader().single('image')(req, res, next);
    }
  ];
};

// Debug middleware setup
const setupDebugMiddleware = (app) => {
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
};

// Export everything with a clear structure
module.exports = {
  // Core functionality
  logger,
  ErrorHandler,

  // Authentication middleware
  isAuthenticated,
  forwardAuthenticated,
  isAdmin,

  // Error handling middleware
  handleNotFound: errorMiddleware.notFound,
  handleError: errorMiddleware.error,

  // Setup functions
  setupSecurity,
  setupApplication: InitializationMiddleware.setupApplication.bind(InitializationMiddleware),
  setupDirectories: InitializationMiddleware.setupDirectories.bind(InitializationMiddleware),
  setupBasicMiddleware: InitializationMiddleware.setupBasicMiddleware.bind(InitializationMiddleware),
  detectInstanceType: InitializationMiddleware.detectInstanceType.bind(InitializationMiddleware),
  configureStorageType: InitializationMiddleware.configureStorageType.bind(InitializationMiddleware),

  // Additional middleware
  setupStaticMiddleware,
  createMultipartMiddleware,
  setupDebugMiddleware
}; 