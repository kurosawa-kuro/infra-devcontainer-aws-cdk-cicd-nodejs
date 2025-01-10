const logger = require('../../logger');

// HTTPリクエストのロギング
const requestLogging = (req, res, next) => {
  const startTime = Date.now();
  const originalEnd = res.end;

  res.end = function(...args) {
    const responseTime = Date.now() - startTime;
    logger.logHttpRequest(req, res, responseTime);
    originalEnd.apply(res, args);
  };

  next();
};

// エラーのロギング
const errorLogging = (err, req, res, next) => {
  logger.logError(err, req);
  next(err);
};

// ビジネスアクションのロギング設定
const setupBusinessLogging = (app) => {
  app.set('logBusinessAction', (action, data) => {
    logger.logBusinessAction(action, data);
  });
};

// データベースエラーのロギング
const logDatabaseError = (operation, error, context = {}) => {
  logger.logDatabaseError(operation, error, context);
};

module.exports = {
  requestLogging,
  errorLogging,
  setupBusinessLogging,
  logDatabaseError
}; 