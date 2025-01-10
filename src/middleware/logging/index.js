const winston = require('winston');
const { format } = winston;

// ログフォーマットの設定
const logFormat = format.printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [${level}] ${message}`;
  
  if (Object.keys(metadata).length > 0) {
    msg += ` ${JSON.stringify(metadata)}`;
  }
  
  return msg;
});

// Winstonロガーの設定
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.metadata({ fillExcept: ['message', 'level', 'timestamp'] }),
    format.colorize(),
    logFormat
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  ]
});

// 開発環境用の設定
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: format.simple()
  }));
}

// ロギング関連のユーティリティ関数
const isApiRequest = (req) => {
  return req.xhr || req.headers.accept?.includes('application/json');
};

// ロギング関数群
const logging = {
  // HTTPリクエストのログ記録
  request: (req, res, responseTime) => {
    const logData = {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      responseTime: `${responseTime}ms`,
      userAgent: req.get('user-agent'),
      userId: req.user?.id
    };

    if (res.statusCode >= 400) {
      logger.warn('HTTP Request Error', logData);
    } else {
      logger.info('HTTP Request', logData);
    }
  },

  // エラーログの記録
  error: (error, req = null) => {
    const logData = {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      }
    };

    if (req) {
      logData.request = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        query: req.query,
        body: req.body,
        userId: req.user?.id
      };
    }

    logger.error('Error occurred', logData);
  },

  // ビジネスアクションのログ記録
  business: (action, data = {}) => {
    logger.info(`Business Action: ${action}`, data);
  },

  // データベースエラーのログ記録
  database: (operation, error, context = {}) => {
    logger.error('Database Error', {
      operation,
      error: {
        name: error.name,
        message: error.message,
        code: error.code,
        stack: error.stack
      },
      context
    });
  },

  // システムエラーのログ記録
  system: (message, error, context = {}) => {
    logger.error('System Error', {
      message,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      },
      context
    });
  }
};

// ミドルウェア関数群
const middleware = {
  // HTTPリクエストのロギング
  request: (req, res, next) => {
    const startTime = Date.now();
    const originalEnd = res.end;

    res.end = function(...args) {
      const responseTime = Date.now() - startTime;
      logging.request(req, res, responseTime);
      originalEnd.apply(res, args);
    };

    next();
  },

  // エラーのロギング
  error: (err, req, res, next) => {
    logging.error(err, req);
    next(err);
  },

  // ビジネスアクションのロギング設定
  setupBusiness: (app) => {
    app.set('logBusinessAction', logging.business);
  }
};

module.exports = {
  logger,
  logging,
  middleware,
  isApiRequest
}; 