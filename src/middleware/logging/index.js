const winston = require('winston');
const { format } = winston;

// ログレベルの定義
const LOG_LEVELS = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug'
};

// 機密情報をマスクする関数
const maskSensitiveData = (data) => {
  if (!data) return data;
  const masked = { ...data };
  const sensitiveFields = ['password', 'token', 'secret', 'authorization'];
  
  Object.keys(masked).forEach(key => {
    if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
      masked[key] = '********';
    }
  });
  
  return masked;
};

// ログフォーマットの設定
const logFormat = format.printf(({ level, message, timestamp, ...metadata }) => {
  const maskedMetadata = maskSensitiveData(metadata);
  return JSON.stringify({
    timestamp,
    level,
    message,
    ...maskedMetadata
  });
});

// 環境に基づいたログレベルの設定
const getLogLevel = () => {
  switch (process.env.NODE_ENV) {
    case 'production':
      return LOG_LEVELS.WARN;
    case 'test':
      return LOG_LEVELS.INFO;
    default:
      return LOG_LEVELS.DEBUG;
  }
};

// Winstonロガーの設定
const logger = winston.createLogger({
  level: getLogLevel(),
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    format.metadata({ fillExcept: ['message', 'level', 'timestamp'] }),
    logFormat
  ),
  transports: [
    new winston.transports.File({
      filename: 'logs/error.log',
      level: LOG_LEVELS.ERROR,
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 5,
    })
  ]
});

// 開発環境用のコンソール出力設定
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: format.combine(
      format.colorize(),
      format.simple()
    )
  }));
}

// HTTPリクエストのログ記録
const logRequest = (req, res, responseTime) => {
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
};

// エラーログの記録
const logError = (error, req = null) => {
  const logData = {
    error: {
      name: error.name,
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }
  };

  if (req) {
    logData.request = {
      method: req.method,
      url: req.url,
      headers: maskSensitiveData(req.headers),
      query: req.query,
      userId: req.user?.id
    };
  }

  logger.error('Error occurred', logData);
};

// データベースログの記録
const logDatabase = (operation, error = null, context = {}) => {
  const logData = {
    operation,
    context: maskSensitiveData(context)
  };

  if (error) {
    logData.error = {
      name: error.name,
      message: error.message,
      code: error.code,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    };
    logger.error('Database Error', logData);
  } else {
    logger.info('Database Operation', logData);
  }
};

// リクエストロギングミドルウェア
const requestLogger = (req, res, next) => {
  const startTime = Date.now();
  
  // レスポンス終了時にログを記録
  const originalEnd = res.end;
  res.end = function(...args) {
    const responseTime = Date.now() - startTime;
    logRequest(req, res, responseTime);
    originalEnd.apply(res, args);
  };
  
  next();
};

// エラーロギングミドルウェア
const errorLogger = (err, req, res, next) => {
  logError(err, req);
  next(err);
};

module.exports = {
  logger,
  LOG_LEVELS,
  middleware: {
    request: requestLogger,
    error: errorLogger
  },
  logError,
  logDatabase
}; 