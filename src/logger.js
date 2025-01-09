const winston = require('winston');
const path = require('path');

// ログフォーマットの定義
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// ログファイルのパス設定
const logDir = 'logs';
const errorLogPath = path.join(logDir, 'error.log');
const combinedLogPath = path.join(logDir, 'combined.log');

// ロガーの作成
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'user-service' },
  transports: [
    // エラーレベルのログをファイルに出力
    new winston.transports.File({
      filename: errorLogPath,
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // 全てのログをファイルに出力
    new winston.transports.File({
      filename: combinedLogPath,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  ]
});

// 開発環境の場合はコンソールにも出力
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

// ログレベルのショートカット関数
const info = (message, meta = {}) => logger.info(message, meta);
const error = (message, meta = {}) => logger.error(message, meta);
const warn = (message, meta = {}) => logger.warn(message, meta);
const debug = (message, meta = {}) => logger.debug(message, meta);

// エラーオブジェクトのログ用ヘルパー関数
const logError = (err, meta = {}) => {
  const errorMeta = {
    ...meta,
    stack: err.stack,
    message: err.message,
  };
  logger.error(err.message, errorMeta);
};

module.exports = {
  logger,
  info,
  error,
  warn,
  debug,
  logError
};
