const express = require('express');
const asyncHandler = require('express-async-handler');
const path = require('path');
const { isAuthenticated, forwardAuthenticated, isAdmin, handleNotFound, handleError } = require('./middleware');
const fs = require('fs');
const csrf = require('csurf');
const cookieParser = require('cookie-parser');
const session = require('express-session');

function setupRoutes(app, controllers, fileUploader) {
  const { 
    auth, 
    profile, 
    micropost, 
    system, 
    development: dev,  // developmentをdevとしてエイリアス
    admin, 
    category, 
    like, 
    notification 
  } = controllers;

  console.log('\n=== Middleware Setup Start ===');

  /**
   * Middleware Order is Critical:
   * 1. Cookie Parser (Required for session and CSRF)
   * 2. Session Middleware (Required for CSRF)
   * 3. CSRF Protection
   * 4. Routes Configuration
   */

  // 1. Cookie Parser - Required for sessions
  app.use((req, res, next) => {
    console.log('\n=== Middleware Execution Order ===');
    console.log('1. Cookie Parser');
    cookieParser()(req, res, next);
  });

  // レイアウトのデバッグ用ミドルウェア
  app.use((req, res, next) => {
    const originalRender = res.render;
    res.render = function(view, options, callback) {
      console.log('\n=== Express-EJS-Layouts Render Process ===');
      console.log('1. Original View:', view);
      console.log('2. Original Options:', {
        ...options,
        _locals: undefined,
        cache: undefined,
        settings: undefined
      });

      const wrappedCallback = function(err, html) {
        console.log('\n=== Layout Render Callback ===');
        console.log('3. Error:', err);
        console.log('4. Has HTML:', !!html);
        if (callback) {
          callback(err, html);
        }
      };

      try {
        return originalRender.call(this, view, options, wrappedCallback);
      } catch (error) {
        console.error('\n=== Render Error ===');
        console.error('5. Error:', error);
        throw error;
      }
    };
    next();
  });

  // デフッグ: リクエストヘッダーとセッション情報をログ
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

  // ===================================
  // Static Assets
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
  app.get('/home', asyncHandler(async (req, res) => {
    res.locals.title = 'ホーム';
    await micropost.index(req, res);
  }));

  // System Health
  app.get('/health', asyncHandler((req, res) => {
    res.locals.title = 'システム状態';
    return system.getHealth(req, res);
  }));
  app.get('/health-db', asyncHandler((req, res) => {
    res.locals.title = 'データベース状態';
    return system.getDbHealth(req, res);
  }));

  // Categories
  const categoryRouter = express.Router();
  categoryRouter.get('/', asyncHandler((req, res) => {
    res.locals.title = 'カテゴリー一覧';
    return category.index(req, res);
  }));
  categoryRouter.get('/:id([0-9]+)', asyncHandler((req, res) => {
    res.locals.title = 'カテゴリー詳細';
    return category.show(req, res);
  }));
  app.use('/categories', categoryRouter);

  // ===================================
  // Authentication Routes
  // ===================================
  const authRouter = express.Router();
  authRouter.get('/signup', forwardAuthenticated, (req, res) => {
    res.locals.title = 'ユーザー登録';
    return auth.getSignupPage(req, res);
  });
  authRouter.post('/signup', forwardAuthenticated, asyncHandler((req, res) => auth.signup(req, res)));
  authRouter.get('/login', forwardAuthenticated, (req, res) => {
    res.locals.title = 'ログイン';
    return auth.getLoginPage(req, res);
  });
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
  devRouter.get('/', asyncHandler(async (req, res) => dev.index(req, res)));
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
  app.use(handleNotFound);
  app.use(handleError);

  return app;
}

module.exports = setupRoutes; 