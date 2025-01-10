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
const { ErrorHandler } = require('./error');

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

const setupMiddleware = {
  setupBasicMiddleware: (app) => {
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(expressLayouts);
    app.set('layout', 'layouts/public');
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));
    
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
    const errorHandler = new ErrorHandler();
    app.use(cookieParser(process.env.COOKIE_SECRET || 'your-cookie-secret'));

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

    const csrfMiddleware = csrf({
      cookie: true,
      ignoreMethods: ['GET', 'HEAD', 'OPTIONS'],
      value: function (req) {
        return req.headers['x-csrf-token'] || 
               req.body?._csrf || 
               req.cookies['XSRF-TOKEN'];
      }
    });

    app.use((req, res, next) => {
      if (req.headers['content-type']?.includes('multipart/form-data')) {
        const token = req.cookies['XSRF-TOKEN'];
        if (!token) {
          logger.warn('CSRF token missing for multipart request', {
            path: req.path,
            method: req.method
          });
          return errorHandler.handleValidationError(req, res, 'セッションが無効になりました。ページを再読み込みしてください。');
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
              logger.warn('CSRF validation failed', {
                error: err.message,
                path: req.path,
                method: req.method
              });
              return errorHandler.handleValidationError(req, res, 'セッションが無効になりました。ページを再読み込みしてください。');
            }
            const token = req.csrfToken();
            res.locals.csrfToken = token;
            next();
          });
        }
      } catch (error) {
        logger.error('Error in CSRF middleware:', error);
        return errorHandler.handleInternalError(req, res, error);
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
  ...setupMiddleware,
  addLocals
}; 