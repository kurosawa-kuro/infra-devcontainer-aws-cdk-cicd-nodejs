const winston = require('winston');
const path = require('path');

// 起動時に環境をチェック
const validateEnvironment = () => {
  const env = process.env.NODE_ENV;
  if (!['development', 'production', 'test'].includes(env)) {
    throw new Error(`Invalid NODE_ENV: ${env}`);
  }
  return env;
};

// 環境に基づいてログディレクトリを設定
const getLogDir = () => {
  const env = validateEnvironment();
  return path.join('logs', env);
};

// 基本的なログフォーマット
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// ログファイルの設定
const logDir = getLogDir();
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5242880,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 5242880,
      maxFiles: 5,
    })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

// 共通のメタデータを作成する関数
const createBaseMetadata = () => ({
  timestamp: new Date().toISOString()
});

// HTTPリクエストログ
const logHttpRequest = (req, res, responseTime) => {
  const metadata = {
    ...createBaseMetadata(),
    method: req.method,
    path: req.originalUrl,
    statusCode: res.statusCode,
    responseTime,
    userId: req.user?.id
  };

  logger.info('HTTP Request', metadata);
};

// ビジネスアクションログ
const logBusinessAction = (action, data) => {
  const metadata = {
    ...createBaseMetadata(),
    action,
    category: data.category,
    userId: data.userId,
    details: data.details
  };

  logger.info('Business Action', metadata);
};

// エラーログ
const logError = (err, req = null) => {
  const metadata = {
    ...createBaseMetadata(),
    error: {
      name: err.name,
      message: err.message,
      stack: err.stack
    }
  };

  if (req) {
    metadata.request = {
      method: req.method,
      path: req.originalUrl,
      userId: req.user?.id
    };
  }

  logger.error('Error', metadata);
};

// システムエラーログ
const logSystemError = (message, error, context = {}) => {
  const metadata = {
    ...createBaseMetadata(),
    ...context,
    error: error ? {
      name: error.name,
      message: error.message,
      stack: error.stack
    } : null
  };

  logger.error(message, metadata);
};

// データベースエラーログ
const logDatabaseError = (operation, error, context = {}) => {
  const metadata = {
    ...createBaseMetadata(),
    operation,
    ...context,
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack
    }
  };

  logger.error('Database Error', metadata);
};

// APIリクエストログ
const logApiRequest = (req, res, responseTime) => {
  const metadata = {
    ...createBaseMetadata(),
    method: req.method,
    path: req.originalUrl,
    statusCode: res.statusCode,
    responseTime,
    userId: req.user?.id,
    isXHR: req.xhr || false,
    acceptHeader: req.headers.accept
  };

  logger.info('API Request', metadata);
};

// 基本的なログレベル関数
const info = (message, meta = {}) => logger.info(message, { ...createBaseMetadata(), ...meta });
const error = (message, meta = {}) => logger.error(message, { ...createBaseMetadata(), ...meta });
const warn = (message, meta = {}) => logger.warn(message, { ...createBaseMetadata(), ...meta });
const debug = (message, meta = {}) => logger.debug(message, { ...createBaseMetadata(), ...meta });

// APIリクエストの判定
const isApiRequest = (req) => {
  return req.xhr || 
         req.headers.accept?.toLowerCase().includes('application/json') ||
         req.headers['x-requested-with']?.toLowerCase() === 'xmlhttprequest';
};

module.exports = {
  logger,
  info,
  error,
  warn,
  debug,
  logHttpRequest,
  logBusinessAction,
  logError,
  logSystemError,
  logDatabaseError,
  logApiRequest,
  isApiRequest
};
