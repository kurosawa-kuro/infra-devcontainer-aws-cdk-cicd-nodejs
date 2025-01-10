const errorMiddleware = require('./error');
const authMiddleware = require('./auth');
const loggingMiddleware = require('./logging');
const commonMiddleware = require('./common');

module.exports = {
  ...errorMiddleware,
  ...authMiddleware,
  ...loggingMiddleware,
  ...commonMiddleware
}; 