const winston = require('winston');
const { format } = winston;
require('winston-daily-rotate-file');

// ログレベルの定義
const LOG_LEVELS = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  HTTP: 'http',
  VERBOSE: 'verbose',
  DEBUG: 'debug'
};

// 機密情報をマスクする関数
const maskSensitiveData = (data) => {
  if (!data) return data;
  const masked = { ...data };
  const sensitiveFields = [
    'password',
    'token',
    'secret',
    'authorization',
    'creditCard',
    'ssn',
    'apiKey'
  ];
  
  const maskValue = (obj) => {
    if (typeof obj !== 'object' || obj === null) return obj;
    const maskedObj = Array.isArray(obj) ? [...obj] : { ...obj };
    
    Object.keys(maskedObj).forEach(key => {
      if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
        maskedObj[key] = '********';
      } else if (typeof maskedObj[key] === 'object') {
        maskedObj[key] = maskValue(maskedObj[key]);
      }
    });
    
    return maskedObj;
  };
  
  return maskValue(masked);
};

// パフォーマンスメトリクスの収集
const performanceMetrics = {
  requestCount: 0,
  errorCount: 0,
  slowRequests: 0,
  lastResetTime: Date.now(),
  
  reset() {
    this.requestCount = 0;
    this.errorCount = 0;
    this.slowRequests = 0;
    this.lastResetTime = Date.now();
  },
  
  getMetrics() {
    const duration = (Date.now() - this.lastResetTime) / 1000;
    return {
      requestsPerSecond: this.requestCount / duration,
      errorsPerSecond: this.errorCount / duration,
      slowRequestsPerSecond: this.slowRequests / duration,
      totalRequests: this.requestCount,
      totalErrors: this.errorCount,
      totalSlowRequests: this.slowRequests,
      uptime: duration
    };
  }
};

// ログフォーマットの設定
const logFormat = format.printf(({ level, message, timestamp, ...metadata }) => {
  const maskedMetadata = maskSensitiveData(metadata);
  return JSON.stringify({
    timestamp,
    level,
    message,
    traceId: metadata.traceId,
    ...maskedMetadata
  });
});

// 環境に基づいたログレベルの設定
const getLogLevel = () => {
  switch (process.env.NODE_ENV) {
    case 'production':
      return LOG_LEVELS.INFO;
    case 'test':
      return LOG_LEVELS.DEBUG;
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
    new winston.transports.DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: LOG_LEVELS.ERROR,
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true
    }),
    new winston.transports.DailyRotateFile({
      filename: 'logs/combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true
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
    userId: req.user?.id,
    ip: req.ip,
    traceId: req.traceId,
    referer: req.get('referer'),
    contentLength: res.get('content-length'),
    protocol: req.protocol
  };

  performanceMetrics.requestCount++;
  if (responseTime > 1000) {
    performanceMetrics.slowRequests++;
  }

  if (res.statusCode >= 400) {
    performanceMetrics.errorCount++;
    logger.warn('HTTP Request Error', logData);
  } else {
    logger.info('HTTP Request', logData);
  }
};

// エキュリティイベントのログ記録
const logSecurityEvent = (event, req = null, context = {}) => {
  const logData = {
    event,
    timestamp: new Date().toISOString(),
    ip: req?.ip,
    userId: req?.user?.id,
    userAgent: req?.get('user-agent'),
    ...context
  };

  logger.warn('Security Event', logData);
};

// エラーログの記録
const logError = (error, req = null) => {
  const logData = {
    error: {
      name: error.name,
      message: error.message,
      code: error.code,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    },
    traceId: req?.traceId
  };

  if (req) {
    logData.request = {
      method: req.method,
      url: req.url,
      headers: maskSensitiveData(req.headers),
      query: maskSensitiveData(req.query),
      userId: req.user?.id,
      ip: req.ip
    };
  }

  logger.error('Error occurred', logData);
};

// データベースログの記録
const logDatabase = (operation, error = null, context = {}) => {
  const logData = {
    operation,
    timestamp: new Date().toISOString(),
    context: maskSensitiveData(context),
    traceId: context.traceId
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
  // トレースIDの生成
  req.traceId = require('crypto').randomUUID();
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

// メトリクスの定期的なリセット（1時間ごと）
setInterval(() => {
  const metrics = performanceMetrics.getMetrics();
  logger.info('Performance Metrics', { metrics });
  performanceMetrics.reset();
}, 3600000);

module.exports = {
  logger,
  LOG_LEVELS,
  middleware: {
    request: requestLogger,
    error: errorLogger
  },
  logError,
  logDatabase,
  logSecurityEvent,
  getMetrics: () => performanceMetrics.getMetrics()
}; 