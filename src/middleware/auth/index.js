const session = require('express-session');
const passport = require('passport');
const flash = require('connect-flash');
const csrf = require('csurf');
const { ErrorHandler } = require('../error');
const { PassportService } = require('../../services');

// 認証状態チェックミドルウェア
const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/auth/login');
};

const forwardAuthenticated = (req, res, next) => {
  if (!req.isAuthenticated()) {
    return next();
  }
  res.redirect('/');
};

const isAdmin = (req, res, next) => {
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
};

const canManageUser = (req, res, next) => {
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
};

// セッション設定
const setupSession = (app) => {
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
};

// CSRF保護
const setupCSRF = (app) => {
  const errorHandler = new ErrorHandler();
  
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
            return errorHandler.handleValidationError(req, res, 'セッションが無効になりました。ページを再読み込みしてください。');
          }
          const token = req.csrfToken();
          res.locals.csrfToken = token;
          next();
        });
      }
    } catch (error) {
      return errorHandler.handleInternalError(req, res, error);
    }
  });
};

function setupAuthMiddleware(app, config) {
  const passportService = new PassportService(app.get('prisma'), app.get('logger'));
  const passport = passportService.getPassport();
  
  app.use(passport.initialize());
  app.use(passport.session());
  
  // ... other auth middleware setup ...
}

module.exports = {
  isAuthenticated,
  forwardAuthenticated,
  isAdmin,
  canManageUser,
  setupSession,
  setupCSRF,
  setupAuthMiddleware
}; 