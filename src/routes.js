const express = require('express');
const asyncHandler = require('express-async-handler');
const path = require('path');
const { isAuthenticated, forwardAuthenticated, isAdmin, handle404Error, handle500Error } = require('./middleware');
const fs = require('fs');
const csrf = require('csurf');
const cookieParser = require('cookie-parser');
const session = require('express-session');

function setupRoutes(app, controllers, fileUploader) {
  const { auth, profile, micropost, system, dev, admin, category, like, notification } = controllers;

  /**
   * Middleware Order is Critical:
   * 1. Cookie Parser (Required for session and CSRF)
   * 2. Session Middleware (Required for CSRF)
   * 3. CSRF Protection
   * 4. Routes Configuration
   */

  // 1. Cookie Parser - Required for sessions
  app.use(cookieParser());

  // 2. Session Configuration - Must come before CSRF
  app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000 // 24時間
    }
  }));

  // デバッグ: リクエストヘッダーとセッション情報をログ
  app.use((req, res, next) => {
    console.log('\n=== Request Debug Info ===');
    console.log('Request Headers:', req.headers);
    console.log('Session ID:', req.sessionID);
    console.log('Session:', req.session);
    console.log('Cookies:', req.cookies);
    console.log('Method:', req.method);
    console.log('Path:', req.path);
    console.log('Content-Type:', req.get('Content-Type'));
    next();
  });

  // 3. CSRF Protection Setup
  const csrfProtection = csrf({ 
    cookie: {
      key: '_csrf',
      signed: false
    },
    value: (req) => {
      // デバッグ: CSRFトークンの取得試行をログ
      console.log('\n=== CSRF Token Extraction ===');
      console.log('Headers:', {
        'x-csrf-token': req.headers['x-csrf-token'],
        'x-xsrf-token': req.headers['x-xsrf-token'],
      });
      console.log('Cookies:', req.cookies);
      
      // マルチパートフォームデータの場合の特別処理
      if (req.headers['content-type']?.includes('multipart/form-data')) {
        console.log('Multipart form data detected');
        // _csrfクッキーからトークンを取得
        const token = req.cookies['_csrf'];
        console.log('Token from _csrf cookie:', token);
        return token;
      }
      
      // 通常のリクエストの場合
      const token = 
        req.headers['x-csrf-token'] ||
        req.headers['x-xsrf-token'] ||
        req.body?._csrf ||
        req.query?._csrf;
      
      console.log('Selected Token:', token);
      return token;
    }
  });
  
  app.use(csrfProtection);

  // CSRFトークンをすべてのレスポンスに追加
  app.use((req, res, next) => {
    const token = req.csrfToken();
    console.log('\n=== CSRF Token Generation ===');
    console.log('Generated Token:', token);
    
    // _csrfクッキーを設定
    res.cookie('_csrf', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax'
    });
    console.log('Set _csrf cookie:', token);
    
    // テンプレートで使用するためにlocalsに設定
    res.locals.csrfToken = token;
    console.log('Set token in res.locals.csrfToken');
    
    next();
  });

  // ===================================
  // Static Assets - No CSRF needed
  // ===================================
  if (process.env.STORAGE_PROVIDER !== 's3') {
    const uploadsPath = path.join(__dirname, 'public', 'uploads');
    app.use('/uploads', express.static(uploadsPath, {
      setHeaders: (res, path, stat) => {
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Cache-Control', 'public, max-age=31557600');
      },
      fallthrough: false
    }));
  }
  
  app.use('/css', express.static(path.join(__dirname, 'public', 'css'), {
    setHeaders: (res, path, stat) => {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Cache-Control', 'public, max-age=31557600');
    }
  }));

  app.use('/images', express.static(path.join(__dirname, 'public', 'images'), {
    setHeaders: (res, path, stat) => {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Cache-Control', 'public, max-age=31557600');
    }
  }));

  // ===================================
  // Public Routes
  // ===================================

  // Root and Home
  app.get('/', (req, res) => res.redirect('/home'));
  app.get('/home', asyncHandler((req, res) => micropost.index(req, res)));

  // System Health
  app.get('/health', asyncHandler((req, res) => system.getHealth(req, res)));
  app.get('/health-db', asyncHandler((req, res) => system.getDbHealth(req, res)));

  // Categories
  const categoryRouter = express.Router();
  categoryRouter.get('/', asyncHandler((req, res) => category.index(req, res)));
  categoryRouter.get('/:id([0-9]+)', asyncHandler((req, res) => category.show(req, res)));  // 数字のIDのみマッチ
  app.use('/categories', categoryRouter);

  // ===================================
  // Authentication Routes
  // ===================================
  const authRouter = express.Router();
  authRouter.get('/signup', forwardAuthenticated, (req, res) => auth.getSignupPage(req, res));
  authRouter.post('/signup', forwardAuthenticated, asyncHandler((req, res) => auth.signup(req, res)));
  authRouter.get('/login', forwardAuthenticated, (req, res) => auth.getLoginPage(req, res));
  authRouter.post('/login', forwardAuthenticated, asyncHandler((req, res) => auth.login(req, res)));
  authRouter.get('/logout', isAuthenticated, asyncHandler((req, res) => auth.logout(req, res)));
  app.use('/auth', authRouter);

  // ===================================
  // Protected Routes (Authenticated)
  // ===================================
  
  // Microposts
  const micropostRouter = express.Router();
  micropostRouter.use(isAuthenticated);
  
  // マルチパートフォームデータの処理
  micropostRouter.post('/',
    // 1. マルチパートデータのパース
    (req, res, next) => {
      console.log('\n=== Initial Request Debug ===');
      console.log('Content-Type:', req.get('Content-Type'));
      console.log('Cookies:', req.cookies);
      
      if (!req.is('multipart/form-data')) {
        return next();
      }

      const busboy = require('busboy');
      const bb = busboy({ headers: req.headers });
      const fields = {};
      const fileInfo = {};

      bb.on('file', (name, file, info) => {
        console.log('\n=== File Field ===');
        console.log('Field name:', name);
        console.log('File info:', info);
        
        // ファイルストリームを消費
        file.resume();
      });

      bb.on('field', (name, val, info) => {
        console.log('\n=== Form Field ===');
        console.log('Field name:', name);
        console.log('Field value:', val);
        fields[name] = val;
      });

      bb.on('finish', () => {
        console.log('\n=== Form Data Complete ===');
        console.log('All fields:', fields);
        req.body = fields;
        next();
      });

      req.pipe(bb);
    },

    // 2. CSRF検証
    (req, res, next) => {
      console.log('\n=== CSRF Verification ===');
      console.log('Form CSRF:', req.body?._csrf);
      console.log('Cookie CSRF:', req.cookies._csrf);
      
      if (!req.body?._csrf) {
        console.log('Error: No CSRF token in form data');
        return res.status(403).json({ error: 'CSRF token missing' });
      }

      if (req.body._csrf !== req.cookies._csrf) {
        console.log('Error: CSRF token mismatch');
        console.log('Form:', req.body._csrf);
        console.log('Cookie:', req.cookies._csrf);
        return res.status(403).json({ error: 'Invalid CSRF token' });
      }

      next();
    },

    // 3. ファイルアップロード
    (req, res, next) => {
      console.log('\n=== File Upload ===');
      if (!req.files?.image) {
        console.log('No file to upload');
        return next();
      }

      fileUploader.getUploader().single('image')(req, res, (err) => {
        if (err) {
          console.log('Upload error:', err);
          return next(err);
        }
        console.log('Upload success:', req.file);
        next();
      });
    },

    // 4. コントローラー処理
    asyncHandler(async (req, res) => {
      console.log('\n=== Controller ===');
      console.log('Final body:', req.body);
      console.log('Final file:', req.file);
      await micropost.create(req, res);
    })
  );
  
  // いいね関連のルート
  micropostRouter.post('/:id/like', asyncHandler((req, res) => {
    return like.like(req, res);
  }));
  
  micropostRouter.delete('/:id/like', asyncHandler((req, res) => {
    return like.unlike(req, res);
  }));
  
  micropostRouter.get('/:id/likes', asyncHandler((req, res) => like.getLikedUsers(req, res)));
  
  // コメント関連のルート
  micropostRouter.post('/:micropostId/comments', asyncHandler((req, res) => {
    return controllers.comment.create(req, res);
  }));
  
  app.use('/microposts', micropostRouter);

  // User actions
  const userRouter = express.Router();
  userRouter.use(isAuthenticated);
  userRouter.get('/:id/following', asyncHandler((req, res) => profile.following(req, res)));
  userRouter.get('/:id/followers', asyncHandler((req, res) => profile.followers(req, res)));
  userRouter.post('/:id/follow', asyncHandler((req, res) => profile.follow(req, res)));
  userRouter.post('/:id/unfollow', asyncHandler((req, res) => profile.unfollow(req, res)));
  userRouter.get('/:id/likes', asyncHandler((req, res) => like.getUserLikes(req, res)));
  app.use('/users', userRouter);

  // ===================================
  // Admin Routes
  // ===================================
  const adminRouter = express.Router();
  adminRouter.use(isAuthenticated, isAdmin);
  adminRouter.get('/', asyncHandler((req, res) => admin.dashboard(req, res)));
  adminRouter.get('/users', asyncHandler((req, res) => admin.manageUsers(req, res)));
  adminRouter.get('/users/:id', asyncHandler((req, res) => admin.showUser(req, res)));
  adminRouter.post('/users/:id/roles', asyncHandler((req, res) => admin.updateUserRoles(req, res)));
  app.use('/admin', adminRouter);

  // ===================================
  // Development Routes
  // ===================================
  const devRouter = express.Router();
  devRouter.get('/', asyncHandler((req, res) => dev.index(req, res)));
  devRouter.get('/quick-login/:email', asyncHandler((req, res) => dev.quickLogin(req, res)));
  app.use('/dev', devRouter);

  // ===================================
  // Notification Routes
  // ===================================
  const notificationRouter = express.Router();
  notificationRouter.use(isAuthenticated);
  notificationRouter.get('/', asyncHandler((req, res) => notification.index(req, res)));
  notificationRouter.post('/:id/read', asyncHandler((req, res) => notification.markAsRead(req, res)));
  app.use('/notifications', notificationRouter);

  // ===================================
  // User Profile Routes
  // ===================================
  const profileRouter = express.Router();
  profileRouter.get('/:id', asyncHandler((req, res) => profile.show(req, res)));
  profileRouter.get('/:id/edit', isAuthenticated, asyncHandler((req, res) => profile.getEditPage(req, res)));
  profileRouter.post('/:id/edit', isAuthenticated, fileUploader.getUploader().single('avatar'), asyncHandler((req, res) => profile.update(req, res)));
  app.use('/profile', profileRouter);

  // Add additional routes for backward compatibility
  app.get('/users/:id/edit', isAuthenticated, asyncHandler((req, res) => profile.getEditPage(req, res)));
  app.post('/users/:id/edit', isAuthenticated, fileUploader.getUploader().single('avatar'), asyncHandler((req, res) => profile.update(req, res)));

  // ===================================
  // Error Handlers
  // ===================================
  app.use(handle404Error);
  app.use(handle500Error);

  return app;
}

module.exports = setupRoutes; 