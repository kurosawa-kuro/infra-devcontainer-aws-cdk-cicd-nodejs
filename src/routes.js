const express = require('express');
const asyncHandler = require('express-async-handler');
const path = require('path');
const { isAuthenticated, forwardAuthenticated } = require('./middleware/auth');
const isAdmin = require('./middleware/adminAuth');

function setupRoutes(app, controllers, fileUploader) {
  const { auth, profile, micropost, system, dev, admin } = controllers;

  // Public routes
  app.get('/', (req, res) => {
    res.render('index', {
      title: 'ホーム',
      path: req.path
    });
  });

  // System routes
  app.get('/health', asyncHandler((req, res) => system.getHealth(req, res)));
  app.get('/health-db', asyncHandler((req, res) => system.getDbHealth(req, res)));

  // Dev routes
  app.get('/dev', asyncHandler((req, res) => dev.index(req, res)));
  app.get('/dev/quick-login/:email', asyncHandler((req, res) => dev.quickLogin(req, res)));

  // Auth routes
  app.get('/auth/signup', forwardAuthenticated, (req, res) => auth.getSignupPage(req, res));
  app.post('/auth/signup', forwardAuthenticated, asyncHandler((req, res) => auth.signup(req, res)));
  app.get('/auth/login', forwardAuthenticated, (req, res) => auth.getLoginPage(req, res));
  app.post('/auth/login', forwardAuthenticated, asyncHandler((req, res) => auth.login(req, res)));
  app.get('/auth/logout', isAuthenticated, asyncHandler((req, res) => auth.logout(req, res)));

  // Profile routes
  app.get('/profile/:id', isAuthenticated, asyncHandler((req, res) => profile.show(req, res)));
  app.get('/profile/:id/edit', isAuthenticated, asyncHandler((req, res) => profile.getEditPage(req, res)));
  app.post('/profile/:id/edit', isAuthenticated, fileUploader.createUploader().single('avatar'), asyncHandler((req, res) => profile.update(req, res)));

  // Micropost routes
  app.get('/microposts', isAuthenticated, asyncHandler((req, res) => micropost.index(req, res)));
  app.post('/microposts', isAuthenticated, fileUploader.createUploader().single('image'), asyncHandler((req, res) => micropost.create(req, res)));

  // Static routes
  if (!process.env.STORAGE_S3_BUCKET) {
    app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
  }
  app.use('/css', express.static(path.join(__dirname, 'public/css')));

  // Admin routes
  const adminRouter = express.Router();
  adminRouter.use(isAuthenticated);
  adminRouter.use(isAdmin);
  adminRouter.get('/', asyncHandler((req, res) => admin.dashboard(req, res)));
  adminRouter.get('/manage-user', asyncHandler((req, res) => admin.manageUser(req, res)));
  app.use('/admin', adminRouter);

  return app;
}

module.exports = setupRoutes; 