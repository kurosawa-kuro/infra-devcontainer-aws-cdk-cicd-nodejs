const session = require('express-session');
const passport = require('passport');
const flash = require('connect-flash');
const csrf = require('csurf');
const helmet = require('helmet');
const xss = require('xss-clean');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { logger } = require('./logging');

// セキュリティ設定の定数
const SECURITY_CONSTANTS = {
  RATE_LIMIT: {
    API: {
      WINDOW_MS: 15 * 60 * 1000,  // 15分
      MAX_REQUESTS: 100
    },
    LOGIN: {
      WINDOW_MS: 60 * 60 * 1000,  // 1時間
      MAX_ATTEMPTS: 5
    }
  },
  CSRF: {
    COOKIE_OPTIONS: {
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax',
      path: '/',
      httpOnly: true
    }
  }
};

// 認証状態をチェックするミドルウェア
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

// 未認証ユーザーのみアクセス可能なルートを制御するミドルウェア
const forwardAuthenticated = (req, res, next) => {
  if (!req.isAuthenticated()) {
    return next();
  }
  res.redirect('/');
};

// 管理者権限チェックミドルウェア
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

// セッション設定の構成
const setupSession = (app) => {
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
    rolling: true
  };

  if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
    sessionConfig.proxy = true;
  }

  app.use(session(sessionConfig));
  app.use(flash());
  app.use(passport.initialize());
  app.use(passport.session());
};

// CSRFトークンの検証
const validateToken = (token) => {
  return token && token.length >= 32 && /^[a-zA-Z0-9_-]+$/.test(token);
};

// CSRF保護の設定
const setupCSRF = (app) => {
  const csrfOptions = {
    cookie: {
      key: '_csrf',
      ...SECURITY_CONSTANTS.CSRF.COOKIE_OPTIONS
    },
    ignoreMethods: ['GET', 'HEAD', 'OPTIONS'],
    value: (req) => {
      const token = 
        req.headers['x-csrf-token'] || 
        req.body?._csrf || 
        req.cookies['XSRF-TOKEN'];

      // テスト環境では検証を緩和
      if (process.env.NODE_ENV === 'test') {
        return token || 'test-csrf-token';
      }

      if (req.method !== 'GET' && !validateToken(token)) {
        throw new Error('Invalid CSRF token');
      }
      return token;
    }
  };

  // テスト環境ではCSRF保護を無効化するオプションを追加
  if (process.env.NODE_ENV === 'test') {
    csrfOptions.ignoreMethods = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'DELETE', 'PATCH'];
  }

  const csrfMiddleware = csrf(csrfOptions);

  app.use((req, res, next) => {
    if (req.headers['content-type']?.includes('multipart/form-data')) {
      return next();
    }

    csrfMiddleware(req, res, (err) => {
      if (err) {
        logger.error('CSRF error:', err);
        return res.status(403).json({
          error: 'Forbidden',
          message: 'セキュリティトークンが無効です'
        });
      }
      
      const token = req.csrfToken();
      res.cookie('XSRF-TOKEN', token, SECURITY_CONSTANTS.CSRF.COOKIE_OPTIONS);
      res.locals.csrfToken = token;
      next();
    });
  });
};

// セキュリティヘッダーの設定
const setupSecurityHeaders = (app) => {
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: ["'self'", process.env.API_URL || '*'],
        fontSrc: ["'self'", "data:", "https:"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
        formAction: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false
  }));

  app.use(xss());
};

// レート制限の設定
const setupRateLimits = (app) => {
  const apiLimiter = rateLimit({
    windowMs: SECURITY_CONSTANTS.RATE_LIMIT.API.WINDOW_MS,
    max: SECURITY_CONSTANTS.RATE_LIMIT.API.MAX_REQUESTS,
    message: 'リクエスト数が制限を超えました。しばらく時間をおいて再度お試しください。'
  });

  const loginLimiter = rateLimit({
    windowMs: SECURITY_CONSTANTS.RATE_LIMIT.LOGIN.WINDOW_MS,
    max: SECURITY_CONSTANTS.RATE_LIMIT.LOGIN.MAX_ATTEMPTS,
    message: 'ログイン試行回数が制限を超えました。1時間後に再度お試しください。'
  });

  app.use('/api', apiLimiter);
  app.use('/auth/login', loginLimiter);
};

// セキュリティミドルウェアの統合セットアップ
const setupSecurity = (app) => {
  app.use(cookieParser(process.env.COOKIE_SECRET));
  setupSecurityHeaders(app);
  setupSession(app);
  setupCSRF(app);
  setupRateLimits(app);
};

module.exports = {
  isAuthenticated,
  forwardAuthenticated,
  isAdmin,
  setupSecurity,
  SECURITY_CONSTANTS
}; 