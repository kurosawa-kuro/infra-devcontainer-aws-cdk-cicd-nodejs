const session = require('express-session');
const passport = require('passport');
const flash = require('connect-flash');
const csrf = require('csurf');
const { ErrorHandler } = require('../error');
const { PassportService } = require('../../services');
const { logger } = require('../logging');

/**
 * @typedef {Object} User
 * @property {number} id
 * @property {string} email
 * @property {Array<{role: {name: string}}>} userRoles
 */

/**
 * 認証状態をチェックするミドルウェア
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'ログインが必要です'
    });
  }
  
  req.flash('error', 'ログインが必要です');
  res.redirect('/auth/login');
};

/**
 * 未認証ユーザーのみアクセス可能なルートを制御するミドルウェア
 */
const forwardAuthenticated = (req, res, next) => {
  if (!req.isAuthenticated()) {
    return next();
  }
  res.redirect('/');
};

/**
 * 管理者権限チェックミドルウェア
 */
const isAdmin = (req, res, next) => {
  if (!req.isAuthenticated()) {
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'ログインが必要です'
      });
    }
    req.flash('error', 'ログインが必要です');
    return res.redirect('/auth/login');
  }

  const isAdmin = req.user.userRoles?.some(ur => ur.role.name === 'admin');
  if (!isAdmin) {
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(403).json({
        error: 'Forbidden',
        message: '管理者権限が必要です'
      });
    }
    req.flash('error', '管理者権限が必要です');
    return res.redirect('/');
  }

  next();
};

/**
 * ユーザー管理権限チェックミドルウェア
 */
const canManageUser = (req, res, next) => {
  if (!req.isAuthenticated()) {
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'ログインが必要です'
      });
    }
    return res.redirect('/auth/login');
  }

  const isOwnProfile = req.user.id === parseInt(req.params.id, 10);
  const isAdmin = req.user.userRoles?.some(ur => ur.role.name === 'admin');

  if (isOwnProfile || isAdmin) {
    return next();
  }

  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.status(403).json({ 
      error: 'Forbidden',
      message: '他のユーザーのプロフィールは編集できません'
    });
  }

  req.flash('error', '他のユーザーのプロフィールは編集できません');
  res.redirect('/');
};

/**
 * 必須環境変数の検証
 * @throws {Error} 必須環境変数が設定されていない場合
 */
const validateEnvironmentVariables = () => {
  const requiredVars = {
    SESSION_SECRET: process.env.SESSION_SECRET,
    COOKIE_SECRET: process.env.COOKIE_SECRET,
    SESSION_MAX_AGE: process.env.SESSION_MAX_AGE
  };

  const missingVars = Object.entries(requiredVars)
    .filter(([_, value]) => !value)
    .map(([key]) => key);

  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }
};

/**
 * セッション設定の構成
 * @param {import('express').Application} app
 */
const setupSession = (app) => {
  validateEnvironmentVariables();

  const sessionConfig = {
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: 'sessionId',
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: parseInt(process.env.SESSION_MAX_AGE, 10) || 86400000,
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
      path: '/'
    },
    rolling: true // セッションの有効期限を自動延長
  };

  if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
    sessionConfig.proxy = true;
  }

  if (process.env.NODE_ENV === 'test') {
    sessionConfig.cookie.secure = false;
  }

  app.use(session(sessionConfig));

  app.use((req, res, next) => {
    if (!req.session) {
      return next(new Error('セッションの初期化に失敗しました'));
    }
    next();
  });

  app.use(flash());
  app.use(passport.initialize());
  app.use(passport.session());
};

/**
 * CSRFトークンの検証
 * @param {string} token
 * @returns {boolean}
 */
const validateToken = (token) => {
  return token && token.length >= 32 && /^[a-zA-Z0-9_-]+$/.test(token);
};

/**
 * CSRFトークンのクッキー設定を生成
 * @returns {Object} クッキー設定
 */
const getCsrfCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
  path: '/',
  maxAge: 7200000 // 2時間
});

/**
 * CSRF保護の設定
 * @param {import('express').Application} app
 */
const setupCSRF = (app) => {
  const errorHandler = new ErrorHandler();
  
  const csrfMiddleware = csrf({
    cookie: {
      key: '_csrf',
      ...getCsrfCookieOptions()
    },
    ignoreMethods: ['GET', 'HEAD', 'OPTIONS'],
    value: (req) => {
      const token = 
        req.headers['x-csrf-token'] || 
        req.body?._csrf || 
        req.cookies['XSRF-TOKEN'];

      if (req.method !== 'GET' && !validateToken(token)) {
        throw new Error('Invalid CSRF token');
      }
      return token;
    }
  });

  app.use((req, res, next) => {
    // セキュリティヘッダー
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    if (req.headers['content-type']?.includes('multipart/form-data')) {
      return handleMultipartFormData(req, res, next, errorHandler);
    }

    try {
      csrfMiddleware(req, res, (err) => {
        if (err) {
          logger.error('CSRF error:', err);
          return errorHandler.handleValidationError(req, res, 'セキュリティトークンが無効です');
        }
        
        setupCsrfToken(req, res);
        next();
      });
    } catch (error) {
      logger.error('CSRF setup error:', error);
      return errorHandler.handleInternalError(req, res, error);
    }
  });
};

/**
 * マルチパートフォームデータのCSRF処理
 */
const handleMultipartFormData = (req, res, next, errorHandler) => {
  const token = req.cookies['XSRF-TOKEN'];
  if (!token) {
    try {
      const newToken = require('csrf')().create(process.env.COOKIE_SECRET);
      res.cookie('XSRF-TOKEN', newToken, getCsrfCookieOptions());
      res.locals.csrfToken = newToken;
      return next();
    } catch (error) {
      logger.error('CSRF token generation error:', error);
      return errorHandler.handleValidationError(req, res, 'セキュリティトークンの生成に失敗しました');
    }
  }

  if (!validateToken(token)) {
    return errorHandler.handleValidationError(req, res, 'セキュリティトークンが無効です');
  }

  req.csrfToken = () => token;
  res.locals.csrfToken = token;
  next();
};

/**
 * CSRFトークンの設定
 */
const setupCsrfToken = (req, res) => {
  const token = req.csrfToken();
  res.cookie('XSRF-TOKEN', token, getCsrfCookieOptions());
  res.locals.csrfToken = token;
};

/**
 * 認証ミドルウェアの初期設定
 * @param {import('express').Application} app
 * @param {Object} config
 */
const setupAuthMiddleware = (app, config = {}) => {
  const passportService = new PassportService(app.get('prisma'), logger);
  passportService.configurePassport();
  
  setupSession(app);
  setupCSRF(app);
};

module.exports = {
  isAuthenticated,
  forwardAuthenticated,
  isAdmin,
  canManageUser,
  setupSession,
  setupCSRF,
  setupAuthMiddleware
}; 