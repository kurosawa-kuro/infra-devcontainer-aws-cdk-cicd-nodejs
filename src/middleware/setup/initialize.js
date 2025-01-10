const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const busboy = require('busboy');
const { logger } = require('../core/logging');
const { setupSecurity } = require('../core/security');

class InitializationMiddleware {
  static async setupCore(app, passportService) {
    logger.info('Initializing core middleware components');

    // Basic middleware setup
    this.setupBasicMiddleware(app);
    
    // Security setup
    setupSecurity(app);
    
    // Passport setup
    passportService.configurePassport();
  }

  static setupBasicMiddleware(app) {
    // Body parser
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Static files
    app.use(express.static(path.join(__dirname, '../../public')));

    // View engine
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '../..', 'views'));

    // Layout
    app.use(expressLayouts);
    app.set('layout', 'layouts/public');
    app.set("layout extractScripts", true);
    app.set("layout extractStyles", true);

    // Static file serving
    if (process.env.STORAGE_PROVIDER !== 's3') {
      app.use('/uploads', express.static(path.join(__dirname, '../../public/uploads'), {
        fallthrough: false,
        setHeaders: (res) => {
          res.set('Access-Control-Allow-Origin', '*');
          res.set('Cache-Control', 'public, max-age=31557600');
        }
      }));
    }
    
    app.use('/css', express.static(path.join(__dirname, '../../public/css')));
    app.use('/images', express.static(path.join(__dirname, '../../public/images')));

    // デフォルトのレスポンス変数を設定
    app.use((req, res, next) => {
      res.locals.title = 'ページ';
      res.locals.user = req.user;
      res.locals.path = req.path;
      next();
    });
  }

  static async detectInstanceType(util) {
    try {
      const instanceType = await util.checkInstanceType();
      logger.info(`Starting application on ${instanceType}`);
      return instanceType;
    } catch (instanceTypeError) {
      logger.warn('Failed to determine instance type, defaulting to Lightsail/Other:', instanceTypeError);
      return 'Lightsail/Other';
    }
  }

  static configureStorageType(instanceType) {
    if (instanceType === 'Lightsail/Other') {
      logger.info('Running on Lightsail - using local storage configuration');
      process.env.USE_S3 = 'false';
    } else {
      logger.info('Running on EC2 - using S3 storage configuration');
      process.env.USE_S3 = 'true';
    }
  }

  static setupMultipartHandling(app, fileUploader) {
    const busboy = require('busboy');

    app.use((req, res, next) => {
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
    });

    if (fileUploader) {
      app.use((req, res, next) => {
        if (!req.files?.image) return next();
        fileUploader.getUploader().single('image')(req, res, next);
      });
    }
  }

  static async setupApplication(app, routes, controllers, fileUploader) {
    logger.info('Starting application setup');

    // Core setup
    await this.setupCore(app, controllers.passport);

    // Multipart handling setup
    this.setupMultipartHandling(app, fileUploader);

    // Routes setup
    routes(app, controllers, fileUploader);

    logger.info('Application setup completed');
  }

  static async setupDirectories(fileUploader) {
    logger.info('Setting up required directories');
    await fileUploader.setupDirectories();
  }
}

module.exports = InitializationMiddleware; 