const helmet = require('helmet');
const xss = require('xss-clean');
const rateLimit = require('express-rate-limit');
const csrf = require('csurf');
const cookieParser = require('cookie-parser');
const { logger } = require('../logging');

// CSRFミドルウェアの設定
const setupCSRF = (app) => {
  const csrfMiddleware = csrf({
    cookie: true,
    ignoreMethods: ['GET', 'HEAD', 'OPTIONS'],
    value: (req) => {
      return req.headers['x-csrf-token'] || 
             req.body?._csrf || 
             req.cookies['XSRF-TOKEN'];
    }
  });

  // CSRFエラーハンドラー
  const handleCSRFError = (err, req, res, next) => {
    if (err.code !== 'EBADCSRFTOKEN') return next(err);

    // multipart/form-dataリクエストの特別処理
    if (req.headers['content-type']?.includes('multipart/form-data')) {
      const token = req.cookies['XSRF-TOKEN'];
      if (!token) {
        logger.warn('CSRF token missing in multipart request', {
          url: req.url,
          method: req.method
        });
        return res.status(403).json({
          error: 'Invalid CSRF token',
          message: 'セッションが無効になりました。ページを再読み込みしてください。'
        });
      }
      return next();
    }

    // 通常のCSRFエラー処理
    logger.warn('Invalid CSRF token', {
      url: req.url,
      method: req.method
    });

    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(403).json({
        error: 'Invalid CSRF token',
        message: 'セッションが無効になりました。ページを再読み込みしてください。'
      });
    }

    req.flash('error', 'セッションが無効になりました。ページを再読み込みしてください。');
    return res.redirect('back');
  };

  // CSRFミドルウェアの適用
  app.use((req, res, next) => {
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
        if (err) return handleCSRFError(err, req, res, next);
        next();
      });
    }
  });
};

// セキュリティヘッダーの設定
const setupSecurityHeaders = (app) => {
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
};

// レート制限の設定
const setupRateLimits = (app) => {
  // API全般のレート制限
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15分
    max: 100,
    message: 'リクエスト数が制限を超えました。しばらく時間をおいて再度お試しください。',
    standardHeaders: true,
    legacyHeaders: false,
  });

  // ログイン専用のレート制限
  const loginLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1時間
    max: 5,
    message: 'ログイン試行回数が制限を超えました。1時間後に再度お試しください。',
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use('/api', apiLimiter);
  app.use('/auth/login', loginLimiter);
};

// XSS対策の設定
const setupXSSProtection = (app) => {
  app.use(xss());
};

// セキュリティミドルウェアの統合セットアップ
const setupSecurity = (app) => {
  app.use(cookieParser(process.env.COOKIE_SECRET || 'your-cookie-secret'));
  setupSecurityHeaders(app);
  setupXSSProtection(app);
  setupRateLimits(app);
  setupCSRF(app);
};

module.exports = {
  setupSecurity,
  setupCSRF,
  setupSecurityHeaders,
  setupRateLimits,
  setupXSSProtection
}; 