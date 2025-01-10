const { logger } = require('../logging');

class ErrorHandler {
  constructor(uploadLimits) {
    this.uploadLimits = uploadLimits;
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

    // 開発環境でのデバッグ出力を強化
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
      console.log('Stack Trace:', details.error?.stack || 'No stack trace available');
      console.log('=== End Error Debug ===\n');
    }

    this.logger[level]('Error Occurred', logData);
  }

  sendErrorResponse(req, res, { status, message, details = {} }) {
    // デバッグ情報の出力
    if (process.env.NODE_ENV !== 'production') {
      console.log('\n=== Error Response Debug ===');
      console.log('Status:', status);
      console.log('Message:', message);
      console.log('Is API Request:', this.isApiRequest(req));
      console.log('Response Details:', details);
      console.log('=== End Response Debug ===\n');
    }

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
    if (process.env.NODE_ENV !== 'production') {
      console.log('\n=== Validation Error Debug ===');
      console.log('Validation Details:', details);
      console.log('Request Body:', req.body);
      console.log('=== End Validation Debug ===\n');
    }

    this.logError('warn', 'ValidationError', req, { details });
    return this.sendErrorResponse(req, res, {
      status: 400,
      message,
      details
    });
  }

  handleAuthError(req, res, message = '認証が必要です') {
    if (process.env.NODE_ENV !== 'production') {
      console.log('\n=== Auth Error Debug ===');
      console.log('User Session:', req.session);
      console.log('Auth Headers:', req.headers.authorization);
      console.log('=== End Auth Debug ===\n');
    }

    this.logError('warn', 'AuthError', req);
    return this.sendErrorResponse(req, res, {
      status: 401,
      message
    });
  }

  handlePermissionError(req, res, message = '権限がありません') {
    if (process.env.NODE_ENV !== 'production') {
      console.log('\n=== Permission Error Debug ===');
      console.log('User:', req.user);
      console.log('Required Permissions:', req.requiredPermissions);
      console.log('Current Permissions:', req.user?.permissions);
      console.log('=== End Permission Debug ===\n');
    }

    this.logError('warn', 'PermissionError', req);
    return this.sendErrorResponse(req, res, {
      status: 403,
      message
    });
  }

  handleNotFoundError(req, res, message = 'リソースが見つかりません') {
    if (process.env.NODE_ENV !== 'production') {
      console.log('\n=== Not Found Error Debug ===');
      console.log('Requested Path:', req.path);
      console.log('Route Params:', req.params);
      console.log('Query Params:', req.query);
      console.log('=== End Not Found Debug ===\n');
    }

    this.logError('warn', 'NotFound', req);
    return this.sendErrorResponse(req, res, {
      status: 404,
      message
    });
  }

  handleDatabaseError(req, res, error, message = 'データベースエラーが発生しました') {
    if (process.env.NODE_ENV !== 'production') {
      console.log('\n=== Database Error Debug ===');
      console.log('Error:', error);
      console.log('SQL Query:', error.sql);
      console.log('Parameters:', error.parameters);
      console.log('Stack:', error.stack);
      console.log('=== End Database Debug ===\n');
    }

    this.logError('error', 'DatabaseError', req, { error });
    return this.sendErrorResponse(req, res, {
      status: 500,
      message
    });
  }

  handleInternalError(req, res, error) {
    const isDevelopment = process.env.NODE_ENV !== 'production';
    const message = isDevelopment ? error.message : 'サーバーエラーが発生しました';

    if (isDevelopment) {
      console.log('\n=== Internal Server Error Debug ===');
      console.log('Error Name:', error.name);
      console.log('Error Message:', error.message);
      console.log('Error Code:', error.code);
      console.log('Stack Trace:', error.stack);
      console.log('Request Details:', {
        method: req.method,
        path: req.path,
        headers: req.headers,
        body: req.body,
        query: req.query,
        params: req.params
      });
      console.log('=== End Internal Error Debug ===\n');
    }

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
  if (process.env.NODE_ENV !== 'production') {
    console.log('\n=== 404 Middleware Debug ===');
    console.log('Path:', req.path);
    console.log('Method:', req.method);
    console.log('=== End 404 Debug ===\n');
  }

  const errorHandler = new ErrorHandler();
  return errorHandler.handleNotFoundError(req, res);
};

const handleError = (err, req, res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('\n=== Global Error Handler Debug ===');
    console.log('Original Error:', err);
    console.log('Stack Trace:', err.stack);
    console.log('=== End Global Error Debug ===\n');
  }

  const errorHandler = new ErrorHandler();
  return errorHandler.handleInternalError(req, res, err);
};

const handleCSRFError = (err, req, res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('\n=== CSRF Error Debug ===');
    console.log('Error Code:', err.code);
    console.log('Token:', req.csrfToken?.());
    console.log('Headers:', req.headers);
    console.log('=== End CSRF Debug ===\n');
  }

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
  handleNotFound,
  handleError,
  handleCSRFError
}; 