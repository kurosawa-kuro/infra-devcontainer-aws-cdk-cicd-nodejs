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

  // APIリクエストの場合は403を返す
  const isApiRequest = req.xhr || req.headers.accept?.includes('json') || process.env.NODE_ENV === 'test';
  if (isApiRequest) {
    return res.status(403).json({ 
      error: 'Forbidden',
      message: '他のユーザーのプロフィールは編集できません'
    });
  }

  // 通常のリクエストの場合はエラーページを表示
  req.flash('error', '他のユーザーのプロフィールは編集できません');
  res.redirect('/');
};

const handle404Error = (req, res, next) => {
  const isApiRequest = req.xhr || req.headers.accept?.includes('application/json');
  if (isApiRequest) {
    return res.status(404).json({
      error: 'Not Found',
      message: 'リクエストされたページは存在しません'
    });
  }
  res.status(404).render('pages/errors/404', {
    title: 'ページが見つかりません',
    path: req.path
  });
};

function createErrorLogMessage(err, req) {
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

  // エラーオブジェクトの安全な取り扱い
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

function setupErrorLogging(app, logger) {
  app.use((err, req, res, next) => {
    const logMessage = createErrorLogMessage(err, req);
    const logLevel = logMessage.level;

    // エラーメッセージをフォーマット
    const formattedMessage = `
[${logMessage.timestamp}] ${logLevel.toUpperCase()}: ${logMessage.error.name}
URL: ${logMessage.method} ${logMessage.url}
Status: ${logMessage.error.status}
Message: ${logMessage.error.message}
User ID: ${logMessage.userId || 'Not authenticated'}
Environment: ${logMessage.environment}
${logMessage.error.stack ? `Stack: ${logMessage.error.stack}` : ''}
    `.trim();

    // エラーの重要度に応じてログを出力
    logger[logLevel](formattedMessage, {
      metadata: logMessage,
      timestamp: logMessage.timestamp
    });

    next(err);
  });
}

function handle500Error(err, req, res, next) {
  const statusCode = err?.status || 500;
  const message = err?.message || 'Internal Server Error';
  
  // APIリクエストの場合はJSONレスポンス
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(statusCode).json({
      success: false,
      message: message,
      error: process.env.NODE_ENV === 'development' ? err : undefined
    });
  }

  // 通常のリクエストの場合はエラーページを表示
  res.status(statusCode).render('pages/errors/500', {
    message: message,
    error: process.env.NODE_ENV === 'development' ? err : {},
    title: `Error ${statusCode}`,
    path: req.path
  });
}

const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const expressWinston = require('express-winston');
const passport = require('passport');
const session = require('express-session');
const flash = require('connect-flash');

const addLocals = (req, res, next) => {
  res.locals.user = req.user;
  res.locals.error = req.flash('error');
  res.locals.success = req.flash('success');
  res.locals.path = req.path;

  // 管理者ログイン時にレイアウトを切り替え
  if (req.isAuthenticated() && req.user.userRoles?.some(ur => ur.role.name === 'admin')) {
    res.locals.layout = 'layouts/admin';
  }

  next();
};

const setupBasicMiddleware = (app) => {
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
};

const setupAuthMiddleware = (app, config) => {
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
};

const setupRequestLogging = (app, logger) => {
  app.use(expressWinston.logger({
    winstonInstance: logger,
    meta: true,
    msg: (req, res) => createRequestLogMessage(req, res, logger),
    expressFormat: false,
    colorize: true,
    ignoreRoute: (req) => req.url === '/health' || req.url === '/health-db'
  }));
};

const getStatusColor = (statusCode) => {
  if (statusCode >= 500) return '\x1b[31m'; // red
  if (statusCode >= 400) return '\x1b[33m'; // yellow
  if (statusCode >= 300) return '\x1b[36m'; // cyan
  return '\x1b[32m'; // green
};

const getErrorInfo = (req, res) => {
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
};

const getRequestInfo = (req, res) => {
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
};

const createRequestLogMessage = (req, res, logger) => {
  const responseTime = res.responseTime || 0;
  const statusCode = res.statusCode;
  const statusColor = getStatusColor(statusCode);
  const reset = '\x1b[0m';
  
  const errorInfo = getErrorInfo(req, res);
  const requestInfo = getRequestInfo(req, res);

  if (statusCode >= 400) {
    console.error('Request Details:', requestInfo);
    logger.error('Request Details:', requestInfo);
  }

  return `${req.method.padEnd(6)} ${statusColor}${statusCode}${reset} ${req.url.padEnd(30)} ${responseTime}ms${errorInfo}`;
};

module.exports = {
  isAuthenticated,
  forwardAuthenticated,
  isAdmin,
  canManageUser,
  handle404Error,
  handle500Error,
  setupBasicMiddleware,
  setupAuthMiddleware,
  setupRequestLogging,
  setupErrorLogging,
  addLocals,
  getRequestInfo,
  getErrorInfo,
  createRequestLogMessage,
  createErrorLogMessage
}; 