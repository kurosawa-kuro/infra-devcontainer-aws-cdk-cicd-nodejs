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
    console.log('\n=== Internal Error Handler Debug ===');
    console.log('1. Error Details:', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: error.code
    });

    console.log('2. Request Details:', {
      method: req.method,
      path: req.path,
      query: req.query,
      body: req.body,
      headers: req.headers
    });

    this.logger.error('Internal Server Error', {
      error,
      path: req.path,
      user: req.user ? { id: req.user.id } : null
    });

    const message = process.env.NODE_ENV === 'production' 
      ? 'サーバーエラーが発生しました'
      : error.message;

    console.log('3. Response Preparation:', {
      message,
      isDevelopment: process.env.NODE_ENV !== 'production',
      isApiRequest: this.isApiRequest(req)
    });

    if (this.isApiRequest(req)) {
      return res.status(500).json({
        success: false,
        message,
        ...(process.env.NODE_ENV !== 'production' && { error: error.stack })
      });
    }

    console.log('4. Rendering Error Page');
    return res.status(500).render('pages/errors/500', {
      message,
      error: process.env.NODE_ENV !== 'production' ? error : {},
      path: req.path,
      user: req.user,
      title: 'エラーが発生しました'
    });
  }

  handleError(err, req, res, next) {
    console.log('\n=== Error Handler Debug ===');
    console.log('1. Original Error:', {
      name: err.name,
      message: err.message,
      stack: err.stack
    });
    console.log('2. Request Details:', {
      method: req.method,
      path: req.path,
      headers: req.headers
    });

    // エラーの種類に応じたレスポンス
    const statusCode = err.statusCode || 500;
    const errorMessage = err.message || 'Internal Server Error';

    console.log('3. Response Details:', {
      statusCode,
      errorMessage
    });

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(statusCode).json({
        success: false,
        message: errorMessage
      });
    }

    console.log('4. Rendering Error Page');
    res.status(statusCode);
    res.render('pages/errors/500', {
      message: errorMessage,
      error: req.app.get('env') === 'development' ? err : {}
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