const winston = require('winston');
const { format } = winston;
require('winston-daily-rotate-file');
const WinstonCloudWatch = require('winston-cloudwatch');

// ログレベルの定義
const LOG_LEVELS = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  HTTP: 'http',
  VERBOSE: 'verbose',
  DEBUG: 'debug'
};

// ログから除外するURLパターン
const EXCLUDED_PATHS = [
  /^\/css\//,
  /^\/js\//,
  /^\/images\//,
  /^\/fonts\//,
  /^\/assets\//,
  /^\/uploads\//,
  /^\/favicon\.ico$/,
  /^\/robots\.txt$/
];

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

// Winstonロガーの設定
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? LOG_LEVELS.INFO : LOG_LEVELS.DEBUG,
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    format.metadata({ fillExcept: ['message', 'level', 'timestamp'] }),
    format.printf(({ level, message, timestamp, ...metadata }) => {
      const maskedMetadata = maskSensitiveData(metadata);
      return JSON.stringify({
        timestamp,
        level,
        message,
        traceId: metadata.traceId,
        ...maskedMetadata
      });
    })
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

// CloudWatchトランスポートの追加
if (process.env.USE_CLOUDWATCH === 'true') {
  const cloudwatchConfig = {
    logGroupName: process.env.CLOUDWATCH_LOG_GROUP,
    logStreamName: `${process.env.NODE_ENV}-${new Date().toISOString().split('T')[0]}`,
    awsRegion: process.env.CLOUDWATCH_REGION,
    messageFormatter: ({ level, message, ...meta }) => {
      return JSON.stringify({
        level,
        message,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,
        ...meta
      });
    }
  };

  logger.add(new WinstonCloudWatch(cloudwatchConfig));
  logger.info('CloudWatch logging enabled');
}

// 開発環境用のコンソール出力設定
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: format.combine(
      format.colorize(),
      format.simple()
    )
  }));
}

// デバッグミドルウェア
const debugMiddleware = (req, res, next) => {
  // 除外パターンに一致する場合はスキップ
  if (EXCLUDED_PATHS.some(pattern => pattern.test(req.path))) {
    return next();
  }

  if (process.env.NODE_ENV === 'development') {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    
    // リクエストの詳細をデバッグ
    logger.debug('Request Details', {
      method: req.method,
      path: req.path,
      query: req.query,
      body: maskSensitiveData(req.body),
      headers: maskSensitiveData(req.headers),
      ip: req.ip
    });
  }
  next();
};

// リクエストロギングミドルウェア
const requestLogger = (req, res, next) => {
  // 除外パターンに一致する場合はスキップ
  if (EXCLUDED_PATHS.some(pattern => pattern.test(req.path))) {
    return next();
  }

  req.traceId = require('crypto').randomUUID();
  const startTime = Date.now();
  
  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    const logData = {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      responseTime: `${responseTime}ms`,
      userAgent: req.get('user-agent'),
      userId: req.user?.id,
      ip: req.ip,
      traceId: req.traceId
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
  });
  
  next();
};

// エラーロギングミドルウェア
const errorLogger = (err, req, res, next) => {
  const logData = {
    error: {
      name: err.name,
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    },
    request: {
      method: req.method,
      url: req.url,
      headers: maskSensitiveData(req.headers),
      query: maskSensitiveData(req.query),
      body: maskSensitiveData(req.body),
      userId: req.user?.id,
      ip: req.ip,
      traceId: req.traceId
    }
  };

  logger.error('Error occurred', logData);
  next(err);
};

// メトリクスの定期的なリセット（1時間ごと）
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    const metrics = performanceMetrics.getMetrics();
    logger.info('Performance Metrics', { metrics });
    performanceMetrics.reset();
  }, 60 * 60 * 1000); // 1時間
}

module.exports = {
  logger,
  LOG_LEVELS,
  middleware: {
    debug: debugMiddleware,
    request: requestLogger,
    error: errorLogger
  },
  getMetrics: () => performanceMetrics.getMetrics()
}; 