const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const helmet = require('helmet');
const xss = require('xss-clean');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { logger, logging } = require('../logging');

// 基本的なミドルウェアのセットアップ
const setupBasic = (app) => {
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(expressLayouts);
  app.set('layout', 'layouts/public');
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '../../views'));
  
  app.use(express.static(path.join(__dirname, '../../public')));
  app.use('/uploads', express.static(path.join(__dirname, '../../public/uploads')));
  
  app.use((req, res, next) => {
    res.locals.path = req.path;
    next();
  });
};

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
  setupBasic,
  setupSecurity,
  addLocals
}; 