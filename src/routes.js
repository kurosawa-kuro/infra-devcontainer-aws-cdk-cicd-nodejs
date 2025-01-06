const express = require('express');
const asyncHandler = require('express-async-handler');
const path = require('path');
const { isAuthenticated, forwardAuthenticated, isAdmin, handle404Error, handle500Error } = require('./middleware');
const fs = require('fs');

function setupRoutes(app, controllers, fileUploader) {
  const { auth, profile, micropost, system, dev, admin, category, like, notification } = controllers;

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
  categoryRouter.get('/:id', asyncHandler((req, res) => category.show(req, res)));
  app.use('/categories', categoryRouter);

  // Static Assets
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
  micropostRouter.get('/', asyncHandler((req, res) => micropost.index(req, res)));
  micropostRouter.get('/:id', asyncHandler((req, res) => micropost.show(req, res)));
  micropostRouter.post('/', fileUploader.getUploader().single('image'), asyncHandler((req, res) => micropost.create(req, res)));
  
  // いいね関連のルート
  micropostRouter.post('/:id/like', asyncHandler((req, res) => like.like(req, res)));
  micropostRouter.delete('/:id/like', asyncHandler((req, res) => like.unlike(req, res)));
  micropostRouter.get('/:id/likes', asyncHandler((req, res) => like.getLikedUsers(req, res)));
  
  // コメント関連のルート
  micropostRouter.post('/:micropostId/comments', asyncHandler((req, res) => controllers.comment.create(req, res)));
  
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