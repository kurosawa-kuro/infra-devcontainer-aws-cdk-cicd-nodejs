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
    this.logger.warn('Not Found Error', {
      message,
      path: req.path,
      params: req.params,
      user: req.user ? { id: req.user.id } : null
    });

    if (this.isApiRequest(req)) {
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
      message,
      path: req.path,
      params: req.params,
      body: req.body,
      user: req.user ? { id: req.user.id } : null
    });

    if (this.isApiRequest(req)) {
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
      message,
      path: req.path,
      params: req.params,
      query: req.query,
      user: req.user ? { id: req.user.id } : null
    });

    if (this.isApiRequest(req)) {
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
      message,
      path: req.path,
      user: req.user ? { id: req.user.id } : null
    });

    if (this.isApiRequest(req)) {
      return res.status(403).json({
        success: false,
        message
      });
    }
    req.flash('error', message);
    return res.redirect('back');
  }

  handleInternalError(req, res, error) {
    this.logger.error('Internal Server Error', {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      },
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

    if (this.isApiRequest(req)) {
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

  isApiRequest(req) {
    return req.xhr || 
           req.headers.accept?.toLowerCase().includes('application/json') ||
           req.headers['x-requested-with']?.toLowerCase() === 'xmlhttprequest';
  }
}

const errorMiddleware = {
  handle404Error: (req, res, next) => {
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
    console.error('\n=== Internal Server Error ===');
    console.error('Error:', {
      message: err.message,
      name: err.name,
      stack: err.stack
    });
    console.error('Request:', {
      method: req.method,
      path: req.path,
      params: req.params,
      query: req.query,
      body: req.body,
      user: req.user ? { id: req.user.id, email: req.user.email } : null
    });

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

    // エラーページをレンダリングする前にデバッグ情報を出力
    console.error('Attempting to render error page with:', {
      message,
      error: process.env.NODE_ENV === 'development' ? err : {},
      title: `Error ${statusCode}`,
      path: req.path,
      user: req.user ? { id: req.user.id } : null
    });

    try {
      res.status(statusCode).render('pages/errors/500', {
        message: message,
        error: process.env.NODE_ENV === 'development' ? err : {},
        title: `Error ${statusCode}`,
        path: req.path,
        user: req.user
      });
    } catch (renderError) {
      console.error('Error rendering error page:', {
        originalError: err,
        renderError: {
          message: renderError.message,
          stack: renderError.stack
        }
      });
      // エラーページのレンダリングに失敗した場合は、シンプルなエラーレスポンスを返す
      res.status(500).send('Internal Server Error');
    }
  }
};

const loggingUtils = {
  getStatusColor: (statusCode) => {
    if (statusCode >= 500) return '\x1b[31m';
    if (statusCode >= 400) return '\x1b[33m';
    if (statusCode >= 300) return '\x1b[36m';
    return '\x1b[32m';
  },

  getErrorInfo: (req, res) => {
    let errorInfo = '';
    if (res.locals.error) {
      errorInfo = ` - Error: ${res.locals.error}`;
    }
    if (req.session && req.flash) {
      try {
        const flashErrors = req.flash('error');
        if (flashErrors && flashErrors.length > 0) {
          errorInfo += ` - Flash Errors: ${flashErrors.join(', ')}`;
        }
      } catch (e) {
        // Ignore flash errors if session is not available
      }
    }
    return errorInfo;
  },

  getRequestInfo: (req, res) => {
    return {
      method: req.method,
      url: req.url,
      params: req.params,
      query: req.query,
      body: req.body,
      headers: req.headers,
      statusCode: res.statusCode,
      responseTime: res.responseTime
    };
  },

  createRequestLogMessage: (req, res, logger) => {
    const responseTime = res.responseTime || 0;
    const statusCode = res.statusCode;
    const statusColor = loggingUtils.getStatusColor(statusCode);
    const reset = '\x1b[0m';
    
    const errorInfo = loggingUtils.getErrorInfo(req, res);
    const requestInfo = loggingUtils.getRequestInfo(req, res);

    if (statusCode >= 400) {
      console.error('Request Details:', requestInfo);
      logger.error('Request Details:', requestInfo);
    }

    return `${req.method.padEnd(6)} ${statusColor}${statusCode}${reset} ${req.url.padEnd(30)} ${responseTime}ms${errorInfo}`;
  },

  createErrorLogMessage: (err, req) => {
    const baseInfo = {
      url: req.url,
      method: req.method,
      ip: req.ip,
      userId: req.user?.id,
      headers: req.headers,
      query: req.query,
      body: req.body,
      params: req.params
    };

    const errorInfo = {
      message: err?.message || 'Unknown error',
      name: err?.name || 'Error',
      stack: err?.stack || '',
      status: err?.status || 500,
      code: err?.code,
      type: err?.constructor?.name
    };

    return {
      timestamp: new Date().toISOString(),
      level: errorInfo.status >= 500 ? 'error' : 'warn',
      environment: process.env.NODE_ENV || 'development',
      ...baseInfo,
      error: errorInfo
    };
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

  setupRequestLogging: (app, loggingSystem) => {
    // HTTPリクエストのログ
    app.use((req, res, next) => {
      const startTime = Date.now();
      const originalEnd = res.end;

      res.end = function(...args) {
        const responseTime = Date.now() - startTime;
        const logData = {
          LogDate: new Date().toISOString().split('T')[0],
          Category: 'Http',
          Action: `${req.method} ${res.statusCode} ${req.originalUrl}`,
          Value: responseTime,
          Quantity: 1,
          Environment: process.env.NODE_ENV || 'development',
          ErrorMessage: '',
          RequestInfo: {
            method: req.method,
            path: req.originalUrl,
            statusCode: res.statusCode,
            responseTime: responseTime
          },
          User: req.user ? {
            id: req.user.id,
            name: req.user.name
          } : null
        };

        loggingSystem.getLogger().info(JSON.stringify(logData));
        originalEnd.apply(res, args);
      };

      next();
    });

    // ビジネスアクションログのヘルパーをappに追加
    app.set('logBusinessAction', (action, data) => {
      const logData = {
        LogDate: new Date().toISOString().split('T')[0],
        Category: data.category || 'Business',
        Action: action,
        Value: data.value || 0,
        Quantity: data.quantity || 1,
        Environment: process.env.NODE_ENV || 'development',
        ErrorMessage: '',
        Details: data
      };
      loggingSystem.getLogger().info(JSON.stringify(logData));
    });
  },

  setupErrorLogging: (app, logger) => {
    app.use((err, req, res, next) => {
      const logMessage = loggingUtils.createErrorLogMessage(err, req);
      const logLevel = logMessage.level;

      const formattedMessage = `
[${logMessage.timestamp}] ${logLevel.toUpperCase()}: ${logMessage.error.name}
URL: ${logMessage.method} ${logMessage.url}
Status: ${logMessage.error.status}
Message: ${logMessage.error.message}
User ID: ${logMessage.userId || 'Not authenticated'}
Environment: ${logMessage.environment}
${logMessage.error.stack ? `Stack: ${logMessage.error.stack}` : ''}
      `.trim();

      logger[logLevel](formattedMessage, {
        metadata: logMessage,
        timestamp: logMessage.timestamp
      });

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
          console.log('Handling non-GET request');
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
      console.error('カテゴリーの取得に失敗しました:', err);
      res.locals.categories = [];
      next();
    });
  } else {
    res.locals.categories = [];
    next();
  }
};

// ビジネスアクションのログ用ヘルパー関数
const logBusinessAction = (logger, action, data) => {
  const logData = {
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'web-app',
    
    // アクション情報
    category: data.category || 'User',  // User, Content, Interaction等
    action: action,                     // Follow, Post, Like等
    status: data.status || 'success',   // success, failed等
    
    // アクション詳細
    details: {
      actionType: data.actionType,      // create, delete等
      targetType: data.targetType,      // user, post等
      targetId: data.targetId,
      result: data.result
    },

    // メトリクス
    value: data.value || 1,
    quantity: data.quantity || 1,

    // 関連ユーザー情報
    actor: data.actor ? {
      id: data.actor.id,
      name: data.actor.name,
      role: data.actor.role
    } : null,
    
    target: data.target ? {
      id: data.target.id,
      name: data.target.name,
      type: data.target.type
    } : null,

    // 環境情報
    environment: process.env.NODE_ENV || 'development'
  };

  // nullの項目を削除
  Object.keys(logData).forEach(key => {
    if (logData[key] === null || logData[key] === undefined) {
      delete logData[key];
    }
  });

  logger.info(JSON.stringify(logData));
};

// HTTPリクエストログ用の関数（既存のものを改名）
const logHttpRequest = (logger, req, res, responseTime) => {
  const logData = {
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'web-app',
    category: 'Http',
    method: req.method,
    path: req.originalUrl,
    statusCode: res.statusCode,
    responseTime,
    environment: process.env.NODE_ENV || 'development',
    user: req.user ? {
      id: req.user.id,
      name: req.user.name
    } : null
  };

  // nullの項目を削除
  Object.keys(logData).forEach(key => {
    if (logData[key] === null || logData[key] === undefined) {
      delete logData[key];
    }
  });

  logger.info(JSON.stringify(logData));
};

module.exports = {
  ...authMiddleware,
  ...errorMiddleware,
  ...setupMiddleware,
  addLocals,
  ...loggingUtils
}; 