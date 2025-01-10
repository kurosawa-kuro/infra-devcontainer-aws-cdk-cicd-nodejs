const { logger } = require('./logging');

class ErrorHandler {
  constructor() {
    this.logger = logger;
  }

  isApiRequest(req) {
    return req.xhr || req.headers.accept?.includes('application/json');
  }

  logError(level, type, req, details = {}) {
    const baseLogData = {
      type,
      path: req.path,
      method: req.method,
      params: req.params,
      query: req.query,
      user: req.user ? { id: req.user.id } : null,
      timestamp: new Date().toISOString(),
      requestId: req.id
    };

    const logData = {
      ...baseLogData,
      ...details
    };

    if (process.env.NODE_ENV !== 'production') {
      console.log('\n=== Error Debug Information ===');
      console.log('Error Type:', type);
      console.log('Log Level:', level);
      console.log('Request Details:', {
        path: req.path,
        method: req.method,
        params: req.params,
        query: req.query,
        headers: req.headers,
        body: req.body,
        user: req.user
      });
      console.log('Error Details:', details);
      console.log('=== End Error Debug ===\n');
    }

    this.logger[level]('Error Occurred', logData);
  }

  sendErrorResponse(req, res, { status, message, details = {} }) {
    if (this.isApiRequest(req)) {
      return res.status(status).json({
        success: false,
        message,
        ...details
      });
    }

    if (status === 404) {
      return res.status(404).render('pages/errors/404', {
        message,
        path: req.path,
        user: req.user
      });
    }

    if (status === 500) {
      return res.status(500).render('pages/errors/500', {
        message,
        error: process.env.NODE_ENV !== 'production' ? details.error : {},
        path: req.path,
        user: req.user,
        title: 'エラーが発生しました'
      });
    }

    req.flash('error', message);
    return res.redirect(status === 401 ? '/auth/login' : 'back');
  }

  handleValidationError(req, res, message = 'バリデーションエラーが発生しました', details = {}) {
    this.logError('warn', 'ValidationError', req, { details });
    return this.sendErrorResponse(req, res, {
      status: 400,
      message,
      details
    });
  }

  handleAuthError(req, res, message = '認証が必要です') {
    this.logError('warn', 'AuthError', req);
    return this.sendErrorResponse(req, res, {
      status: 401,
      message
    });
  }

  handlePermissionError(req, res, message = '権限がありません') {
    this.logError('warn', 'PermissionError', req);
    return this.sendErrorResponse(req, res, {
      status: 403,
      message
    });
  }

  handleNotFoundError(req, res, message = 'リソースが見つかりません') {
    this.logError('warn', 'NotFound', req);
    return this.sendErrorResponse(req, res, {
      status: 404,
      message
    });
  }

  handleDatabaseError(req, res, error, message = 'データベースエラーが発生しました') {
    this.logError('error', 'DatabaseError', req, { error });
    return this.sendErrorResponse(req, res, {
      status: 500,
      message
    });
  }

  handleInternalError(req, res, error) {
    const isDevelopment = process.env.NODE_ENV !== 'production';
    const message = isDevelopment ? error.message : 'サーバーエラーが発生しました';

    this.logError('error', 'InternalServerError', req, {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code
      }
    });

    return this.sendErrorResponse(req, res, {
      status: 500,
      message,
      details: {
        error: isDevelopment ? error : undefined
      }
    });
  }
}

// エラーハンドリングミドルウェア
const handleNotFound = (req, res) => {
  const errorHandler = new ErrorHandler();
  return errorHandler.handleNotFoundError(req, res);
};

const handleError = (err, req, res, next) => {
  const errorHandler = new ErrorHandler();
  return errorHandler.handleInternalError(req, res, err);
};

const handleCSRFError = (err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    const errorHandler = new ErrorHandler();
    return errorHandler.handleValidationError(
      req,
      res,
      'セッションが無効になりました。ページを再読み込みしてください。'
    );
  }
  next(err);
};

module.exports = {
  ErrorHandler,
  middleware: {
    notFound: handleNotFound,
    error: handleError,
    csrf: handleCSRFError
  }
}; 