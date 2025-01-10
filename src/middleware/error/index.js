const { logger } = require('../logging');

class ErrorHandler {
  constructor(uploadLimits) {
    this.uploadLimits = uploadLimits;
    this.logger = logger;
  }

  isApiRequest(req) {
    return req.xhr || req.headers.accept?.includes('application/json');
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
    this.logger.warn('Auth Error', {
      path: req.path,
      user: req.user ? { id: req.user.id } : null
    });

    if (this.isApiRequest(req)) {
      return res.status(401).json({
        success: false,
        message
      });
    }
    req.flash('error', message);
    return res.redirect('/auth/login');
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
    this.logger.error('Internal Server Error', {
      error,
      path: req.path,
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
    return errorHandler.handleValidationError(req, res, 'セッションが無効になりました。ページを再読み込みしてください。');
  }
  next(err);
};

module.exports = {
  ErrorHandler,
  handleNotFound,
  handleError,
  handleCSRFError
}; 