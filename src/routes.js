const express = require('express');
const asyncHandler = require('express-async-handler');
const { 
  isAuthenticated, 
  forwardAuthenticated, 
  isAdmin, 
  handleNotFound, 
  handleError,
  setupStaticMiddleware,
  createMultipartMiddleware,
  setupDebugMiddleware
} = require('./middleware');
const cookieParser = require('cookie-parser');

function setupRoutes(app, controllers, fileUploader) {
  // コントローラーの存在確認
  if (!controllers) {
    throw new Error('Controllers object is required');
  }

  // 必要なコントローラーの存在確認
  const requiredControllers = [
    'auth',
    'profile',
    'micropost',
    'system',
    'developmentTools',
    'admin',
    'category',
    'like',
    'notification',
    'comment'
  ];

  const missingControllers = requiredControllers.filter(name => !controllers[name]);
  if (missingControllers.length > 0) {
    throw new Error(`Missing required controllers: ${missingControllers.join(', ')}`);
  }

  const { 
    auth, 
    profile, 
    micropost, 
    system, 
    developmentTools,
    admin, 
    category, 
    like, 
    notification,
    comment 
  } = controllers;

  // ===================================
  // 基本ミドルウェア設定
  // ===================================
  app.use(cookieParser());
  setupDebugMiddleware(app);
  setupStaticMiddleware(app);

  // ===================================
  // 公開ルート
  // ===================================
  app.get('/', (req, res) => res.redirect('/home'));
  app.get('/home', asyncHandler(async (req, res) => {
    res.locals.title = 'ホーム';
    await micropost.index(req, res);
  }));

  // システム状態確認
  app.get('/health', asyncHandler((req, res) => {
    res.locals.title = 'システム状態';
    return system.getHealth(req, res);
  }));
  app.get('/health-db', asyncHandler((req, res) => {
    res.locals.title = 'データベース状態';
    return system.getDbHealth(req, res);
  }));

  // カテゴリー
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
  // 認証ルート
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
  authRouter.get('/session', isAuthenticated, asyncHandler((req, res) => auth.getSession(req, res)));
  app.use('/auth', authRouter);

  // ===================================
  // 保護されたルート（要認証）
  // ===================================
  
  // マイクロポスト
  const micropostRouter = express.Router();
  
  // パブリックアクセス可能なルート
  micropostRouter.get('/', asyncHandler((req, res) => micropost.index(req, res)));
  micropostRouter.get('/:id', asyncHandler((req, res) => micropost.show(req, res)));

  // 認証が必要なルート
  micropostRouter.use(isAuthenticated);
  
  // マルチパートフォームデータの処理を createMultipartMiddleware で置き換え
  micropostRouter.post('/', createMultipartMiddleware(fileUploader), asyncHandler(async (req, res) => {
    await micropost.create(req, res);
  }));
  
  // いいね関連
  micropostRouter.post('/:id/like', asyncHandler((req, res) => like.like(req, res)));
  micropostRouter.delete('/:id/like', asyncHandler((req, res) => like.unlike(req, res)));
  micropostRouter.get('/:id/likes', asyncHandler((req, res) => like.getLikedUsers(req, res)));
  
  // コメント
  micropostRouter.post('/:micropostId/comments', asyncHandler((req, res) => {
    return comment.create(req, res);
  }));
  
  app.use('/microposts', micropostRouter);

  // ===================================
  // ユーザー関連ルート
  // ===================================
  
  // パブリックプロフィール表示（認証不要）
  app.get('/users/:username([^/]+)', asyncHandler((req, res) => {
    console.log('=== Public Profile Route Debug ===');
    console.log('Request params:', req.params);
    console.log('Username:', req.params.username);
    return profile.show(req, res);
  }));

  // 認証が必要なユーザー操作
  const userRouter = express.Router();
  userRouter.use(isAuthenticated);
  userRouter.get('/:username/following', asyncHandler((req, res) => profile.following(req, res)));
  userRouter.get('/:username/followers', asyncHandler((req, res) => profile.followers(req, res)));
  userRouter.post('/:username/follow', asyncHandler((req, res) => profile.follow(req, res)));
  userRouter.post('/:username/unfollow', asyncHandler((req, res) => profile.unfollow(req, res)));
  userRouter.get('/:username/likes', asyncHandler((req, res) => like.getUserLikes(req, res)));
  userRouter.get('/:username/edit', asyncHandler((req, res) => profile.getEditPage(req, res)));
  userRouter.post('/:username/edit', createMultipartMiddleware(fileUploader), asyncHandler((req, res) => profile.update(req, res)));
  app.use('/users', userRouter);

  // プロフィール編集ルート（認証必須）
  const profileRouter = express.Router();
  profileRouter.use(isAuthenticated);
  profileRouter.get('/:username/edit', asyncHandler((req, res) => profile.getEditPage(req, res)));
  profileRouter.post('/:username/edit', createMultipartMiddleware(fileUploader), asyncHandler((req, res) => profile.update(req, res)));
  app.use('/profile', profileRouter);

  // 管理者ルート
  const adminRouter = express.Router();
  adminRouter.use(isAuthenticated, isAdmin);
  adminRouter.get('/', asyncHandler((req, res) => admin.dashboard(req, res)));
  adminRouter.get('/users', asyncHandler((req, res) => admin.manageUsers(req, res)));
  adminRouter.get('/users/:id', asyncHandler((req, res) => admin.showUser(req, res)));
  adminRouter.post('/users/:id/roles', asyncHandler((req, res) => admin.updateUserRoles(req, res)));
  app.use('/admin', adminRouter);

  // ===================================
  // 開発者ツールルート（認証不要）
  // ===================================
  const developmentToolsRouter = express.Router();
  
  // 開発ツールのホーム
  developmentToolsRouter.get('/', asyncHandler(async (req, res) => {
    res.locals.title = '開発ツール';
    return developmentTools.index(req, res);
  }));

  // クイックログイン
  developmentToolsRouter.get('/quick-login/:email', asyncHandler((req, res) => {
    res.locals.title = 'クイックログイン';
    return developmentTools.quickLogin(req, res);
  }));

  // メインパスとエイリアスの設定
  app.use('/development-tools', developmentToolsRouter);  // メインパス
  app.use('/dev', developmentToolsRouter);               // エイリアス（短縮パス）

  // 通知ルート
  const notificationRouter = express.Router();
  notificationRouter.use(isAuthenticated);
  notificationRouter.get('/', asyncHandler((req, res) => notification.index(req, res)));
  notificationRouter.post('/:id/read', asyncHandler((req, res) => notification.markAsRead(req, res)));
  app.use('/notifications', notificationRouter);

  // 後方互換性のためのルート
  app.get('/users/:id/edit', isAuthenticated, asyncHandler((req, res) => profile.getEditPage(req, res)));
  app.post('/users/:id/edit', isAuthenticated, createMultipartMiddleware(fileUploader), asyncHandler((req, res) => profile.update(req, res)));

  // エラーハンドラー
  app.use(handleNotFound);
  app.use(handleError);

  return app;
}

module.exports = setupRoutes; 