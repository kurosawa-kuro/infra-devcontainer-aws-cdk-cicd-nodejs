const helmet = require('helmet');
const xss = require('xss-clean');
const rateLimit = require('express-rate-limit');
const csrf = require('csurf');
const cookieParser = require('cookie-parser');
const { logger } = require('../logging');

// デバッグ用のロギング関数
const logSecurityEvent = (type, data) => {
  const logData = {
    timestamp: new Date().toISOString(),
    type,
    ...data
  };

  logger.debug('Security Event:', logData);
  if (process.env.NODE_ENV !== 'production') {
    console.debug('\x1b[33m[Security Debug]\x1b[0m', JSON.stringify(logData, null, 2));
  }
};

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

// CSRFミドルウェアの設定
const setupCSRF = (app) => {
  const csrfMiddleware = csrf({
    cookie: {
      ...SECURITY_CONSTANTS.CSRF.COOKIE_OPTIONS,
      key: 'XSRF-TOKEN'
    },
    ignoreMethods: ['GET', 'HEAD', 'OPTIONS'],
    value: (req) => {
      const token = req.headers['x-csrf-token'] || 
                   req.body?._csrf || 
                   req.cookies['XSRF-TOKEN'];
      
      logSecurityEvent('csrf-token-check', {
        url: req.url,
        method: req.method,
        hasToken: !!token,
        tokenSource: token ? 
          (req.headers['x-csrf-token'] ? 'header' : 
           req.body?._csrf ? 'body' : 'cookie') : 'none'
      });
      
      return token;
    }
  });

  const handleCSRFError = (err, req, res, next) => {
    if (err.code !== 'EBADCSRFTOKEN') return next(err);

    const errorContext = {
      url: req.url,
      method: req.method,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      cookies: req.cookies,
      headers: {
        ...req.headers,
        cookie: undefined // セキュリティのため cookie ヘッダーは除外
      },
      timestamp: new Date().toISOString()
    };

    logSecurityEvent('csrf-error', {
      ...errorContext,
      error: err.message
    });

    const isMultipart = req.headers['content-type']?.includes('multipart/form-data');
    const isApiRequest = req.xhr || req.headers.accept?.includes('json');

    if (isMultipart && req.cookies['XSRF-TOKEN']) {
      logSecurityEvent('csrf-multipart-bypass', {
        ...errorContext,
        reason: 'Multipart request with valid cookie token'
      });
      return next();
    }

    const errorResponse = {
      error: 'Invalid CSRF token',
      message: 'セッションが無効になりました。ページを再読み込みしてください。',
      requestId: Date.now().toString(36) + Math.random().toString(36).substr(2)
    };

    logSecurityEvent('csrf-rejection', {
      ...errorContext,
      errorResponse,
      requestType: isApiRequest ? 'api' : 'browser'
    });

    if (isApiRequest) {
      return res.status(403).json(errorResponse);
    }

    req.flash('error', errorResponse.message);
    return res.redirect('back');
  };

  app.use((req, res, next) => {
    if (req.method === 'GET') {
      csrfMiddleware(req, res, () => {
        const token = req.csrfToken();
        logSecurityEvent('csrf-token-generation', {
          url: req.url,
          method: req.method,
          ip: req.ip,
          tokenGenerated: !!token
        });

        res.cookie('XSRF-TOKEN', token, SECURITY_CONSTANTS.CSRF.COOKIE_OPTIONS);
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
  const helmetConfig = {
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
        formAction: ["'self'"],
        upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
      }
    },
    crossOriginEmbedderPolicy: { policy: "require-corp" },
    crossOriginResourcePolicy: { policy: "same-site" },
    crossOriginOpenerPolicy: { policy: "same-origin" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    }
  };

  app.use(helmet(helmetConfig));

  logSecurityEvent('helmet-config', {
    config: helmetConfig,
    environment: process.env.NODE_ENV
  });

  // CORS設定
  const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',') 
    : ['http://localhost:3000'];

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const isAllowed = allowedOrigins.includes(origin);

    logSecurityEvent('cors-check', {
      origin,
      isAllowed,
      method: req.method,
      url: req.url
    });

    if (isAllowed) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-CSRF-Token');
      res.header('Access-Control-Allow-Credentials', 'true');
    }
    
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });
};

// レート制限の設定
const setupRateLimits = (app) => {
  const createLimiter = (options) => {
    const limiter = rateLimit({
      windowMs: options.windowMs,
      max: options.max,
      message: options.message,
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests: options.skipSuccessfulRequests || false,
      keyGenerator: (req) => {
        const key = req.ip + (req.headers['x-forwarded-for'] || '');
        logSecurityEvent('rate-limit-key-generation', {
          key,
          ip: req.ip,
          forwardedFor: req.headers['x-forwarded-for'],
          url: req.url
        });
        return key;
      },
      handler: (req, res) => {
        logSecurityEvent('rate-limit-exceeded', {
          ip: req.ip,
          url: req.url,
          method: req.method,
          headers: {
            ...req.headers,
            cookie: undefined
          },
          limitType: options.type
        });
        res.status(429).json({
          error: 'Too Many Requests',
          message: options.message
        });
      }
    });

    return limiter;
  };

  // API全般のレート制限
  const apiLimiter = createLimiter({
    windowMs: SECURITY_CONSTANTS.RATE_LIMIT.API.WINDOW_MS,
    max: SECURITY_CONSTANTS.RATE_LIMIT.API.MAX_REQUESTS,
    message: 'リクエスト数が制限を超えました。しばらく時間をおいて再度お試しください。',
    type: 'api'
  });

  // ログイン専用のレート制限
  const loginLimiter = createLimiter({
    windowMs: SECURITY_CONSTANTS.RATE_LIMIT.LOGIN.WINDOW_MS,
    max: SECURITY_CONSTANTS.RATE_LIMIT.LOGIN.MAX_ATTEMPTS,
    message: 'ログイン試行回数が制限を超えました。1時間後に再度お試しください。',
    skipSuccessfulRequests: true,
    type: 'login'
  });

  app.use('/api', apiLimiter);
  app.use('/auth/login', loginLimiter);
};

// XSS対策の設定
const setupXSSProtection = (app) => {
  app.use(xss());
  
  app.use((req, res, next) => {
    logSecurityEvent('xss-protection', {
      url: req.url,
      method: req.method,
      contentType: req.headers['content-type']
    });

    res.header('X-XSS-Protection', '1; mode=block');
    next();
  });
};

// セキュリティミドルウェアの統合セットアップ
const setupSecurity = (app) => {
  if (!process.env.COOKIE_SECRET) {
    const error = 'COOKIE_SECRET is not set in environment variables';
    logSecurityEvent('security-setup-error', { error });
    logger.error(error);
    process.exit(1);
  }

  logSecurityEvent('security-setup-start', {
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString()
  });

  app.use(cookieParser(process.env.COOKIE_SECRET));
  setupSecurityHeaders(app);
  setupXSSProtection(app);
  setupRateLimits(app);
  // Note: CSRFはauth/index.jsで設定

  logSecurityEvent('security-setup-complete', {
    timestamp: new Date().toISOString()
  });
};

module.exports = {
  setupSecurity,
  setupCSRF,
  setupSecurityHeaders,
  setupRateLimits,
  setupXSSProtection
}; 