const winston = require('winston');
const WinstonCloudWatch = require('winston-cloudwatch');
const path = require('path');
const fs = require('fs');

class Logger {
  constructor() {
    this.env = this.validateEnvironment();
    this.setupLogDirectory();
    this.logger = this.createLogger();
  }

  validateEnvironment() {
    const env = process.env.NODE_ENV;
    if (!['development', 'production', 'test'].includes(env)) {
      throw new Error(`Invalid NODE_ENV: ${env}`);
    }
    return env;
  }

  setupLogDirectory() {
    const logDir = path.join(process.cwd(), 'logs', this.env);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    this.logDir = logDir;
  }

  createCloudWatchTransport() {
    if (process.env.USE_CLOUDWATCH !== 'true') return null;

    const date = new Date();
    const logStreamName = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

    const transport = new WinstonCloudWatch({
      name: 'cloudwatch',
      logGroupName: process.env.CLOUDWATCH_LOG_GROUP,
      logStreamName: logStreamName,
      awsRegion: process.env.AWS_REGION,
      awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
      awsSecretKey: process.env.AWS_SECRET_ACCESS_KEY,
      messageFormatter: ({ level, message, timestamp, ...meta }) => {
        return JSON.stringify({
          level,
          message,
          timestamp,
          environment: process.env.NODE_ENV,
          ...meta
        });
      },
      uploadRate: 2000,
      retentionInDays: 14,
      jsonMessage: true
    });

    transport.on('error', (err) => {
      console.error('CloudWatch Transport Error:', {
        message: err.message,
        code: err.code,
        time: new Date().toISOString()
      });
    });

    return transport;
  }

  createLogger() {
    const transports = [
      // File transports
      new winston.transports.File({
        filename: path.join(this.logDir, 'error.log'),
        level: 'error',
        maxsize: 5242880,
        maxFiles: 5,
      }),
      new winston.transports.File({
        filename: path.join(this.logDir, 'combined.log'),
        maxsize: 5242880,
        maxFiles: 5,
      }),
      // Console transport
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        )
      })
    ];

    // Add CloudWatch transport if enabled
    const cloudWatchTransport = this.createCloudWatchTransport();
    if (cloudWatchTransport) {
      transports.push(cloudWatchTransport);
    }

    return winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: {
        environment: this.env,
        service: 'app'
      },
      transports,
      exitOnError: false
    });
  }

  // Base logging methods
  log(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    this.logger.log(level, message, { timestamp, ...meta });
  }

  info(message, meta = {}) {
    this.log('info', message, meta);
  }

  error(message, meta = {}) {
    this.log('error', message, meta);
  }

  warn(message, meta = {}) {
    this.log('warn', message, meta);
  }

  debug(message, meta = {}) {
    this.log('debug', message, meta);
  }

  // Specialized logging methods
  logHttpRequest(req, res, responseTime) {
    this.info('HTTP Request', {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      responseTime,
      userId: req.user?.id,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
  }

  logApiRequest(req, res, responseTime) {
    this.info('API Request', {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      responseTime,
      userId: req.user?.id,
      isXHR: req.xhr || false,
      acceptHeader: req.headers.accept,
      ip: req.ip
    });
  }

  logError(err, req = null) {
    const meta = {
      error: {
        name: err.name,
        message: err.message,
        stack: err.stack,
        code: err.code
      }
    };

    if (req) {
      meta.request = {
        method: req.method,
        path: req.originalUrl,
        userId: req.user?.id,
        ip: req.ip
      };
    }

    this.error('Error Occurred', meta);
  }

  logBusinessAction(action, data = {}) {
    this.info('Business Action', {
      action,
      ...data,
      userId: data.userId,
      targetId: data.targetId,
      result: data.result
    });
  }

  logSystemAction(action, data = {}) {
    this.info('System Action', {
      action,
      ...data,
      hostname: require('os').hostname()
    });
  }

  logDatabaseAction(action, data = {}) {
    this.info('Database Action', {
      action,
      ...data,
      duration: data.duration
    });
  }

  logUserAction(action, user, data = {}) {
    this.info('User Action', {
      action,
      userId: user.id,
      userName: user.name,
      userRole: user.userRoles?.[0]?.role?.name,
      ...data
    });
  }

  logAuthAction(action, user, success, data = {}) {
    this.info('Auth Action', {
      action,
      userId: user?.id,
      success,
      ...data
    });
  }
}

// Create singleton instance
const loggerInstance = new Logger();

// Export the singleton instance
module.exports = loggerInstance;
