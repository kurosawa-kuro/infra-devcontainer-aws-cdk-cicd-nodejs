const express = require('express');
const asyncHandler = require('express-async-handler');
const path = require('path');
const { isAuthenticated, forwardAuthenticated, isAdmin } = require('./middleware/auth');

function setupRoutes(app, controllers, fileUploader) {
  const { auth, profile, micropost, system, dev, admin, category } = controllers;

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
  if (!process.env.STORAGE_S3_BUCKET) {
    app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
  }
  app.use('/css', express.static(path.join(__dirname, 'public/css')));

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
  micropostRouter.post('/', fileUploader.createUploader().single('image'), asyncHandler((req, res) => micropost.create(req, res)));
  app.use('/microposts', micropostRouter);

  // ===================================
  // Admin Routes
  // ===================================
  const adminRouter = express.Router();
  adminRouter.use(isAuthenticated, isAdmin);
  adminRouter.get('/', asyncHandler((req, res) => admin.dashboard(req, res)));
  adminRouter.get('/manage-user', asyncHandler((req, res) => admin.manageUser(req, res)));
  adminRouter.get('/manage-user/:id', asyncHandler((req, res) => admin.showUser(req, res)));
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
  // User Profile Routes (最後に配置)
  // ===================================
  app.get('/:id', asyncHandler((req, res) => profile.show(req, res)));
  app.get('/:id/edit', isAuthenticated, asyncHandler((req, res) => profile.getEditPage(req, res)));
  app.post('/:id/edit', isAuthenticated, fileUploader.createUploader().single('avatar'), asyncHandler((req, res) => profile.update(req, res)));
  app.post('/:id/follow', isAuthenticated, asyncHandler((req, res) => profile.follow(req, res)));
  app.post('/:id/unfollow', isAuthenticated, asyncHandler((req, res) => profile.unfollow(req, res)));

  return app;
}

module.exports = setupRoutes; 