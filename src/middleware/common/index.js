const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const helmet = require('helmet');
const xss = require('xss-clean');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { logger, logging } = require('../logging');

// 基本的なミドルウェアのセットアップ
function setupBasicMiddleware(app) {
  console.log('\n=== Basic Middleware Setup ===');
  
  // Body parser
  console.log('1. Setting up body parsers');
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  console.log('Body parsers configured');

  // View engine
  console.log('2. Setting up view engine');
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '../..', 'views'));
  console.log('View engine configured:', {
    engine: app.get('view engine'),
    viewsPath: app.get('views')
  });

  // Layout
  console.log('3. Setting up express-ejs-layouts');
  app.use(expressLayouts);
  app.set('layout', 'layouts/public');
  app.set("layout extractScripts", true);
  app.set("layout extractStyles", true);
  
  // レイアウトのデバッグ用ミドルウェア
  app.use((req, res, next) => {
    const originalRender = res.render;
    res.render = function(view, options, callback) {
      console.log('\n=== View Render Debug ===');
      console.log('View:', view);
      console.log('Layout:', options.layout || app.get('layout'));
      console.log('Options:', {
        title: options.title || res.locals.title,
        hasTitle: 'title' in options || 'title' in res.locals,
        layout: options.layout || app.get('layout')
      });
      
      return originalRender.call(this, view, {
        ...options,
        title: options.title || res.locals.title || 'ページ'
      }, callback);
    };
    next();
  });

  console.log('Express-ejs-layouts configured:', {
    defaultLayout: app.get('layout'),
    extractScripts: app.get('layout extractScripts'),
    extractStyles: app.get('layout extractStyles')
  });

  // デフォルトのレスポンス変数を設定
  app.use((req, res, next) => {
    console.log('\n=== Default Response Variables ===');
    console.log('Before:', {
      locals: res.locals,
      path: req.path,
      user: req.user
    });
    
    res.locals.title = 'ページ';
    res.locals.user = req.user;
    res.locals.path = req.path;
    
    console.log('After:', {
      locals: res.locals,
      title: res.locals.title,
      user: res.locals.user,
      path: res.locals.path
    });
    next();
  });

  console.log('=== Basic Middleware Setup Complete ===\n');
}

// セキュリティ関連のセットアップ
const setupSecurity = (app) => {
  app.use(cookieParser(process.env.COOKIE_SECRET || 'your-cookie-secret'));

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "data:", "https:"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
  }));

  app.use(xss());

  // レート制限の設定
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'リクエスト数が制限を超えました。しばらく時間をおいて再度お試しください。',
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use('/api', limiter);

  const loginLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: 'ログイン試行回数が制限を超えました。1時間後に再度お試しください。',
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use('/auth/login', loginLimiter);
};

// ローカル変数の設定
const addLocals = (req, res, next) => {
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.user = req.user;

  const prisma = req.app.get('prisma');
  if (prisma) {
    prisma.category.findMany({
      include: {
        _count: {
          select: {
            microposts: true
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    }).then(categories => {
      res.locals.categories = categories;
      next();
    }).catch(err => {
      logging.database('fetch_categories', err, {
        user: req.user ? { id: req.user.id } : null
      });
      res.locals.categories = [];
      next();
    });
  } else {
    res.locals.categories = [];
    next();
  }
};

module.exports = {
  setupBasic: setupBasicMiddleware,
  setupSecurity,
  addLocals
}; 