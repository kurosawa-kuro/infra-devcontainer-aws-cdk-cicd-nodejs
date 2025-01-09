const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const expressWinston = require('express-winston');
const passport = require('passport');
const session = require('express-session');
const flash = require('connect-flash');
const helmet = require('helmet');
const csrf = require('csurf');
const rateLimit = require('express-rate-limit');
const xss = require('xss-clean');
const cookieParser = require('cookie-parser');
const logger = require('./logger');

const authMiddleware = {
  isAuthenticated: (req, res, next) => {
    if (req.isAuthenticated()) {
      return next();
    }
    res.redirect('/auth/login');
  },

  forwardAuthenticated: (req, res, next) => {
    if (!req.isAuthenticated()) {
      return next();
    }
    res.redirect('/');
  },

  isAdmin: (req, res, next) => {
    if (!req.isAuthenticated()) {
      req.flash('error', 'ログインが必要です');
      return res.redirect('/auth/login');
    }

    const isAdmin = req.user.userRoles?.some(ur => ur.role.name === 'admin');
    if (!isAdmin) {
      req.flash('error', '管理者権限が必要です');
      return res.redirect('/');
    }

    next();
  },

  canManageUser: (req, res, next) => {
    if (!req.isAuthenticated()) {
      return res.redirect('/auth/login');
    }

    const isOwnProfile = req.user.id === parseInt(req.params.id, 10);
    const isAdmin = req.user.userRoles.some(ur => ur.role.name === 'admin');

    if (isOwnProfile || isAdmin) {
      return next();
    }

    if (req.xhr || req.headers.accept?.includes('json') || process.env.NODE_ENV === 'test') {
      return res.status(403).json({ 
        error: 'Forbidden',
        message: '他のユーザーのプロフィールは編集できません'
      });
    }

    req.flash('error', '他のユーザーのプロフィールは編集できません');
    res.redirect('/');
  }
};

class ErrorHandler {
  constructor(logger) {
    this.logger = logger;
  }

  handleNotFoundError(req, res, message = 'リソースが見つかりません') {
    this.logger.warn('Not Found', {
      path: req.path,
      params: req.params,
      user: req.user ? { id: req.user.id } : null
    });

    if (logger.isApiRequest(req)) {
      return res.status(404).json({
        success: false,
        message
      });
    }
    return res.status(404).render('pages/errors/404', {
      message,
      path: req.path,
      user: req.user
    });
  }

  handleValidationError(req, res, message = 'バリデーションエラーが発生しました') {
    this.logger.warn('Validation Error', {
      path: req.path,
      params: req.params,
      body: req.body,
      user: req.user ? { id: req.user.id } : null
    });

    if (logger.isApiRequest(req)) {
      return res.status(400).json({
        success: false,
        message
      });
    }
    req.flash('error', message);
    return res.redirect('back');
  }

  handleDatabaseError(req, res, message = 'データベースエラーが発生しました') {
    this.logger.error('Database Error', {
      path: req.path,
      params: req.params,
      query: req.query,
      user: req.user ? { id: req.user.id } : null
    });

    if (logger.isApiRequest(req)) {
      return res.status(500).json({
        success: false,
        message
      });
    }
    req.flash('error', message);
    return res.redirect('back');
  }

  handlePermissionError(req, res, message = '権限がありません') {
    this.logger.warn('Permission Error', {
      path: req.path,
      user: req.user ? { id: req.user.id } : null
    });

    if (logger.isApiRequest(req)) {
      return res.status(403).json({
        success: false,
        message
      });
    }
    req.flash('error', message);
    return res.redirect('back');
  }

  handleInternalError(req, res, error) {
    this.logger.logSystemError('Internal Server Error', error, {
      request: {
        path: req.path,
        params: req.params,
        query: req.query,
        body: req.body
      },
      user: req.user ? { id: req.user.id } : null
    });

    const message = process.env.NODE_ENV === 'production' 
      ? 'サーバーエラーが発生しました'
      : error.message;

    if (logger.isApiRequest(req)) {
      return res.status(500).json({
        success: false,
        message,
        ...(process.env.NODE_ENV !== 'production' && { error: error.stack })
      });
    }

    return res.status(500).render('pages/errors/500', {
      message,
      error: process.env.NODE_ENV !== 'production' ? error : {},
      path: req.path,
      user: req.user
    });
  }
}

const errorMiddleware = {
  handle404Error: (req, res, next) => {
    logger.warn('Not Found', {
      path: req.originalUrl,
      method: req.method,
      userId: req.user?.id
    });

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'リクエストされたページは存在しません'
      });
    }
    res.status(404).render('pages/errors/404', {
      title: 'ページが見つかりません',
      path: req.path
    });
  },

  handle500Error: (err, req, res, next) => {
    logger.logError(err, req);

    const statusCode = err?.status || 500;
    const message = err?.message || 'Internal Server Error';
    
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(statusCode).json({
        success: false,
        message: message,
        error: process.env.NODE_ENV === 'development' ? {
          name: err.name,
          message: err.message,
          stack: err.stack
        } : undefined
      });
    }

    try {
      res.status(statusCode).render('pages/errors/500', {
        message: message,
        error: process.env.NODE_ENV === 'development' ? err : {},
        title: `Error ${statusCode}`,
        path: req.path,
        user: req.user
      });
    } catch (renderError) {
      logger.logError(renderError);
      res.status(500).send('Internal Server Error');
    }
  }
};

const setupMiddleware = {
  setupBasicMiddleware: (app) => {
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(expressLayouts);
    app.set('layout', 'layouts/public');
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));
    
    // 静的ファイルの提供設定を追加
    app.use(express.static(path.join(__dirname, 'public')));
    app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
    
    app.use((req, res, next) => {
      res.locals.path = req.path;
      next();
    });
  },

  setupAuthMiddleware: (app, config) => {
    const sessionConfig = {
      secret: process.env.SESSION_SECRET || 'your-session-secret',
      resave: false,
      saveUninitialized: true,
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: parseInt(process.env.SESSION_MAX_AGE, 10) || 24 * 60 * 60 * 1000
      }
    };

    if (process.env.APP_ENV === 'test') {
      sessionConfig.cookie.secure = false;
      sessionConfig.resave = true;
    }

    app.use(session(sessionConfig));
    app.use(flash());
    app.use(passport.initialize());
    app.use(passport.session());
    app.use(addLocals);
  },

  setupRequestLogging: (app) => {
    app.use((req, res, next) => {
      const startTime = Date.now();
      const originalEnd = res.end;

      res.end = function(...args) {
        const responseTime = Date.now() - startTime;
        logger.logHttpRequest(req, res, responseTime);
        originalEnd.apply(res, args);
      };

      next();
    });

    app.set('logBusinessAction', (action, data) => {
      logger.logBusinessAction(action, data);
    });
  },

  setupErrorLogging: (app) => {
    app.use((err, req, res, next) => {
      logger.logError(err, req);
      next(err);
    });
  },

  setupSecurity: (app) => {
    app.use(cookieParser(process.env.COOKIE_SECRET || 'your-cookie-secret'));

    // セッションの設定
    const sessionConfig = {
      secret: process.env.SESSION_SECRET || 'your-session-secret',
      resave: false,
      saveUninitialized: true,
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: parseInt(process.env.SESSION_MAX_AGE, 10) || 24 * 60 * 60 * 1000
      }
    };

    if (process.env.APP_ENV === 'test') {
      sessionConfig.cookie.secure = false;
      sessionConfig.resave = true;
    }

    // セッションとパスポートの初期化を先に行う
    app.use(session(sessionConfig));
    app.use(flash());
    app.use(passport.initialize());
    app.use(passport.session());

    // セキュリティヘッダーの設定
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

    // CSRFミドルウェアの設定を改善
    const csrfMiddleware = csrf({
      cookie: true,
      ignoreMethods: ['GET', 'HEAD', 'OPTIONS'],
      value: function (req) {
        return req.headers['x-csrf-token'] || 
               req.body?._csrf || 
               req.cookies['XSRF-TOKEN'];
      }
    });

    // CSRFトークンの処理を一元化
    app.use((req, res, next) => {

      // multipart/form-dataリクエストの特別処理
      if (req.headers['content-type']?.includes('multipart/form-data')) {
        const token = req.cookies['XSRF-TOKEN'];
        if (!token) {
          console.error('No CSRF token found in cookies for multipart request');
          return res.status(403).json({
            error: 'CSRF token missing',
            message: 'セッションが無効になりました。ページを再読み込みしてください。'
          });
        }
        req.csrfToken = () => token;
        res.locals.csrfToken = token;
        return next();
      }

      try {
        if (req.method === 'GET') {
          csrfMiddleware(req, res, () => {
            const token = req.csrfToken();

            res.cookie('XSRF-TOKEN', token, {
              secure: process.env.NODE_ENV === 'production',
              sameSite: 'Lax',
              path: '/'
            });
            res.locals.csrfToken = token;
            next();
          });
        } else {
          csrfMiddleware(req, res, (err) => {
            if (err) {
              console.error('CSRF validation failed:', {
                error: err.message,
                token: req.body?._csrf,
                cookieToken: req.cookies['XSRF-TOKEN']
              });
              return res.status(403).json({
                error: 'CSRF token invalid',
                message: 'セッションが無効になりました。ページを再読み込みしてください。'
              });
            }
            const token = req.csrfToken();
            res.locals.csrfToken = token;
            next();
          });
        }
      } catch (error) {
        console.error('Error in CSRF middleware:', error);
        next(error);
      }
    });

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
  }
};

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
      logger.logDatabaseError('fetch_categories', err, {
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
  ...authMiddleware,
  ...errorMiddleware,
  ...setupMiddleware,
  addLocals
}; 