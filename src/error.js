const multer = require('multer');
const logger = require('./logger');

// エラーハンドリングを管理するクラス
class ErrorHandler {
  constructor(uploadLimits) {
    this.uploadLimits = uploadLimits;
    this.logger = logger;
  }

  createDetailedErrorLog(error, req, additionalInfo = {}) {
    const errorDetails = {
      category: 'Error',
      action: error.name || 'UnknownError',
      value: error.code || 500,
      quantity: 1,
      error: error.message,
      details: error.details || {},
      userId: req.user?.id,
      requestInfo: {
        method: req.method,
        path: req.path,
        url: req.url
      }
    };

    logger.logError(error, req);

    return errorDetails;
  }

  createValidationError(message, details = {}) {
    const error = new Error(message);
    error.name = 'ValidationError';
    error.code = details.code || 'VALIDATION_ERROR';
    error.details = {
      field: details.field,
      value: details.value,
      constraint: details.constraint,
      ...details
    };
    return error;
  }

  isApiRequest(req) {
    return req.xhr || req.headers.accept?.includes('application/json');
  }

  handle(err, req, res) {
    this.createDetailedErrorLog(err, req);
    
    if (err instanceof multer.MulterError) {
      return this.handleMulterError(err, req, res);
    }

    return this.handleGeneralError(err, req, res);
  }

  handleMulterError(err, req, res) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      const error = this.createValidationError(
        `ファイルサイズが大きすぎます。${this.uploadLimits.fileSize / (1024 * 1024)}MB以下にしてください。`,
        { code: 'LIMIT_FILE_SIZE', field: err.field }
      );
      this.createDetailedErrorLog(error, req);
      return this.sendErrorResponse(req, res, 400, error.message);
    }
    
    const error = this.createValidationError('ファイルアップロードエラー', {
      code: err.code,
      field: err.field
    });
    this.createDetailedErrorLog(error, req);
    return this.sendErrorResponse(req, res, 400, error.message);
  }

  handleGeneralError(err, req, res) {
    const errorDetails = this.createDetailedErrorLog(err, req);
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? 'サーバーエラーが発生しました' 
      : err.message;
    
    return this.sendErrorResponse(
      req, 
      res, 
      err.status || 500, 
      errorMessage,
      process.env.NODE_ENV !== 'production' ? errorDetails : undefined
    );
  }

  sendErrorResponse(req, res, status, message, details = {}) {
    if (this.isApiRequest(req)) {
      return res.status(status).json({
        error: message,
        success: false,
        ...details
      });
    } else {
      try {
        if (req.session && req.flash) {
          req.flash('error', message);
        }
      } catch (e) {
        // Ignore flash errors if session is not available
      }
      const fallbackUrl = req.header('Referer') || '/';
      return res.redirect(fallbackUrl);
    }
  }

  handleValidationError(req, res, message = 'バリデーションエラーが発生しました', details = {}) {
    this.logger.warn('Validation Error', {
      path: req.path,
      params: req.params,
      body: req.body,
      user: req.user ? { id: req.user.id } : null
    });

    if (this.isApiRequest(req)) {
      return res.status(400).json({
        success: false,
        message,
        ...details
      });
    }
    req.flash('error', message);
    return res.redirect('back');
  }

  handleAuthError(req, res, message = '認証が必要です') {
    const error = this.createValidationError(message, { code: 'AUTH_ERROR' });
    this.createDetailedErrorLog(error, req);
    return this.sendErrorResponse(req, res, 401, error.message);
  }

  handlePermissionError(req, res, message = '権限がありません') {
    this.logger.warn('Permission Error', {
      path: req.path,
      user: req.user ? { id: req.user.id } : null
    });

    if (this.isApiRequest(req)) {
      return res.status(403).json({
        success: false,
        message
      });
    }
    req.flash('error', message);
    return res.redirect('back');
  }

  handleNotFoundError(req, res, message = 'リソースが見つかりません') {
    this.logger.warn('Not Found', {
      path: req.path,
      params: req.params,
      user: req.user ? { id: req.user.id } : null
    });

    if (this.isApiRequest(req)) {
      return res.status(404).json({
        success: false,
        message
      });
    }
    return res.status(404).render('pages/errors/404', {
      message,
      path: req.path,
      user: req.user
    });
  }

  handleDatabaseError(req, res, message = 'データベースエラーが発生しました') {
    this.logger.error('Database Error', {
      path: req.path,
      params: req.params,
      query: req.query,
      user: req.user ? { id: req.user.id } : null
    });

    if (this.isApiRequest(req)) {
      return res.status(500).json({
        success: false,
        message
      });
    }
    req.flash('error', message);
    return res.redirect('back');
  }

  handleInternalError(req, res, error) {
    this.logger.logSystemError('Internal Server Error', error, {
      request: {
        path: req.path,
        params: req.params,
        query: req.query,
        body: req.body
      },
      user: req.user ? { id: req.user.id } : null
    });

    const message = process.env.NODE_ENV === 'production' 
      ? 'サーバーエラーが発生しました'
      : error.message;

    if (this.isApiRequest(req)) {
      return res.status(500).json({
        success: false,
        message,
        ...(process.env.NODE_ENV !== 'production' && { error: error.stack })
      });
    }

    return res.status(500).render('pages/errors/500', {
      message,
      error: process.env.NODE_ENV !== 'production' ? error : {},
      path: req.path,
      user: req.user
    });
  }
}

// CSRFエラーハンドリングミドルウェア
const handleCSRFError = (errorHandler) => (err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return errorHandler.handleValidationError(req, res, 'Invalid CSRF token');
  }
  next(err);
};

// 404エラーハンドリングミドルウェア
const handle404Error = (req, res) => {
  logger.warn('404 Not Found:', {
    method: req.method,
    path: req.path,
    url: req.url,
    userId: req.user?.id
  });

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(404).json({
      error: 'Not Found',
      message: 'リクエストされたページは存在しません'
    });
  }

  res.status(404).render('pages/errors/404', {
    title: 'ページが見つかりません',
    message: 'お探しのページは存在しないか、移動または削除された可能性があります。',
    path: req.path,
    user: req.user
  });
};

// 500エラーハンドリングミドルウェア
const handle500Error = (err, req, res, next) => {
  logger.error('Unhandled error:', err);

  const statusCode = err?.status || 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'サーバーエラーが発生しました'
    : (err?.message || 'Internal Server Error');

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(statusCode).json({
      success: false,
      message: message,
      error: process.env.NODE_ENV === 'development' ? {
        name: err.name,
        message: err.message,
        stack: err.stack
      } : undefined
    });
  }

  try {
    res.status(statusCode).render('pages/errors/500', {
      message: message,
      error: process.env.NODE_ENV === 'development' ? err : {},
      title: `Error ${statusCode}`,
      path: req.path,
      user: req.user
    });
  } catch (renderError) {
    logger.error('Error rendering 500 page:', renderError);
    res.status(500).send('Internal Server Error');
  }
};

module.exports = {
  ErrorHandler,
  handleCSRFError,
  handle404Error,
  handle500Error
};
