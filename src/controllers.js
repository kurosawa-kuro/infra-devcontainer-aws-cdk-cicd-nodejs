const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const axios = require('axios');
const passport = require('passport');
const prisma = new PrismaClient();

class BaseController {
  constructor(service, errorHandler, logger) {
    this.service = service;
    this.errorHandler = errorHandler;
    this.logger = logger;
  }

  async handleRequest(req, res, handler) {
    try {
      await handler();
    } catch (error) {
      this.errorHandler.handle(error, req, res);
    }
  }

  renderWithUser(req, res, view, options = {}) {
    const defaultOptions = {
      user: req.user,
      path: req.path
    };
    res.render(view, { ...defaultOptions, ...options });
  }

  sendResponse(req, res, { status = 200, message, data, redirectUrl }) {
    const isApiRequest = req.xhr || req.headers.accept?.includes('application/json');
    
    if (isApiRequest) {
      return res.status(status).json({
        success: status < 400,
        message,
        data
      });
    }

    if (message) {
      req.flash('success', message);
    }
    return res.redirect(redirectUrl);
  }
}

class AuthController extends BaseController {
  constructor(service, errorHandler, logger) {
    super(service, errorHandler, logger);
  }

  getSignupPage(req, res) {
    return this.handleRequest(req, res, async () => {
      this.renderWithUser(req, res, 'auth/signup', { 
        title: 'ユーザー登録'
      });
    });
  }

  getLoginPage(req, res) {
    return this.handleRequest(req, res, async () => {
      this.renderWithUser(req, res, 'auth/login', { 
        title: 'ログイン'
      });
    });
  }

  async signup(req, res) {
    return this.handleRequest(req, res, async () => {
      const user = await this.service.signup(req.body);
      await new Promise((resolve, reject) => {
        req.logIn(user, (err) => err ? reject(err) : resolve());
      });
      this.sendResponse(req, res, {
        message: 'ユーザー登録が完了しました',
        redirectUrl: '/'
      });
    });
  }

  async login(req, res) {
    return this.handleRequest(req, res, async () => {
      await this.service.login(req, res);
      this.sendResponse(req, res, {
        message: 'ログインしました',
        redirectUrl: '/'
      });
    });
  }

  async logout(req, res) {
    return this.handleRequest(req, res, async () => {
      await this.service.logout(req);
      res.clearCookie('connect.sid', {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict'
      });
      this.sendResponse(req, res, {
        message: 'ログアウトしました',
        redirectUrl: '/auth/login'
      });
    });
  }
}

class MicropostController extends BaseController {
  constructor(service, fileUploader, errorHandler, logger) {
    super(service, errorHandler, logger);
    this.fileUploader = fileUploader;
  }

  async index(req, res) {
    return this.handleRequest(req, res, async () => {
      const [microposts, categories] = await Promise.all([
        this.service.getAllMicroposts(),
        this.service.prisma.category.findMany({
          orderBy: { name: 'asc' }
        })
      ]);
      res.render('microposts', { 
        microposts,
        categories,
        title: '投稿一覧',
        path: req.path
      });
    });
  }

  async create(req, res) {
    return this.handleRequest(req, res, async () => {
      const { title, categories } = req.body;
      if (!title?.trim()) {
        throw this.errorHandler.createValidationError('投稿内容を入力してください', {
          code: 'EMPTY_CONTENT',
          field: 'title',
          value: title,
          constraint: 'required'
        });
      }

      let imageUrl = null;
      if (req.file) {
        imageUrl = this.fileUploader.generateFileUrl(req.file);
      }

      await this.service.createMicropost({
        title: title.trim(),
        imageUrl,
        userId: req.user.id,
        categories: Array.isArray(categories) ? categories : categories ? [categories] : []
      });
      
      this.sendResponse(req, res, {
        message: '投稿が完了しました',
        redirectUrl: '/microposts'
      });
    });
  }
}

class ProfileController extends BaseController {
  constructor(service, errorHandler, logger) {
    super(service, errorHandler, logger);
  }

  async show(req, res) {
    return this.handleRequest(req, res, async () => {
      this.logger.debug('Profile show request:', {
        params: req.params,
        userId: req.user?.id,
        path: req.path
      });

      let profileUser;
      if (req.params.id.match(/^[0-9]+$/)) {
        profileUser = await this.service.getUserProfile(req.params.id);
      } else {
        profileUser = await this.service.getUserProfileByName(req.params.id);
      }

      if (!profileUser) {
        this.logger.debug('Profile not found:', {
          params: req.params
        });
        return this.errorHandler.handleNotFoundError(req, res, 'ユーザーが見つかりません');
      }

      this.logger.debug('Profile found:', {
        profileUserId: profileUser.id,
        profileUserName: profileUser.name
      });

      const [microposts, followCounts, isFollowing] = await Promise.all([
        this.service.getMicropostsByUser(profileUser.id),
        this.service.getFollowCounts(profileUser.id),
        req.user ? this.service.isFollowing(req.user.id, profileUser.id) : false
      ]);

      this.logger.debug('Profile data loaded:', {
        followCounts,
        isFollowing,
        micropostsCount: microposts.length
      });

      this.renderWithUser(req, res, 'profile/show', {
        title: 'プロフィール',
        profileUser: profileUser,
        userProfile: profileUser.profile,
        microposts: microposts,
        followCounts,
        isFollowing,
        req: req
      });
    });
  }

  async getEditPage(req, res) {
    return this.handleRequest(req, res, async () => {
      let user;
      let userId;

      if (req.params.id.match(/^[0-9]+$/)) {
        userId = parseInt(req.params.id, 10);
        user = await this.service.getUserProfile(userId);
      } else {
        user = await this.service.getUserProfileByName(req.params.id);
        userId = user ? user.id : null;
      }
      
      if (!user) {
        return this.errorHandler.handleNotFoundError(req, res, 'ユーザーが見つかりません');
      }

      const isOwnProfile = req.user.id === userId;
      const isAdmin = req.user.userRoles.some(ur => ur.role.name === 'admin');

      if (!isOwnProfile && !isAdmin) {
        return this.errorHandler.handlePermissionError(req, res, '他のユーザーのプロフィールは編集できません');
      }

      res.render('profile/edit', {
        title: 'プロフィール編集',
        path: req.path,
        user,
        userProfile: user.profile
      });
    });
  }

  async update(req, res) {
    return this.handleRequest(req, res, async () => {
      let user;
      let userId;

      if (req.params.id.match(/^[0-9]+$/)) {
        userId = parseInt(req.params.id, 10);
        user = await this.service.getUserProfile(userId);
      } else {
        user = await this.service.getUserProfileByName(req.params.id);
        userId = user ? user.id : null;
      }
      
      if (!user) {
        return this.errorHandler.handleNotFoundError(req, res, 'ユーザーが見つかりません');
      }

      const isOwnProfile = req.user.id === userId;
      const isAdmin = req.user.userRoles.some(ur => ur.role.name === 'admin');

      if (!isOwnProfile && !isAdmin) {
        return this.errorHandler.handlePermissionError(req, res, '他のユーザーのプロフィールは編集できません');
      }

      let avatarPath = user.profile?.avatarPath;
      if (req.file) {
        avatarPath = path.basename(req.file.path);
      }

      const updatedUser = await this.service.updateProfile(userId, {
        ...req.body,
        avatarPath
      });
      
      this.sendResponse(req, res, {
        message: 'プロフィールを更新しました',
        redirectUrl: `/${updatedUser.name || userId}`
      });
    });
  }

  async follow(req, res) {
    return this.handleRequest(req, res, async () => {
      if (!req.user) {
        this.logger.debug('Follow attempt without authentication');
        return this.errorHandler.handlePermissionError(req, res, 'ログインが必要です');
      }

      const targetUserId = req.params.id;
      this.logger.debug('Follow request:', {
        followerId: req.user.id,
        targetUserId,
        path: req.path
      });

      await this.service.follow(req.user.id, targetUserId);
      const followCounts = await this.service.getFollowCounts(targetUserId);
      
      this.logger.debug('Follow successful:', {
        followCounts,
        targetUserId
      });

      this.sendResponse(req, res, {
        status: 200,
        message: 'フォローしました',
        data: { followCounts }
      });
    });
  }

  async unfollow(req, res) {
    return this.handleRequest(req, res, async () => {
      if (!req.user) {
        this.logger.debug('Unfollow attempt without authentication');
        return this.errorHandler.handlePermissionError(req, res, 'ログインが必要です');
      }

      const targetUserId = req.params.id;
      this.logger.debug('Unfollow request:', {
        followerId: req.user.id,
        targetUserId,
        path: req.path
      });

      await this.service.unfollow(req.user.id, targetUserId);
      const followCounts = await this.service.getFollowCounts(targetUserId);

      this.logger.debug('Unfollow successful:', {
        followCounts,
        targetUserId
      });

      this.sendResponse(req, res, {
        status: 200,
        message: 'フォロー解除しました',
        data: { followCounts }
      });
    });
  }
}

class SystemController extends BaseController {
  constructor(service, errorHandler, logger) {
    super(service, errorHandler, logger);
  }

  async getHealth(req, res) {
    return this.handleRequest(req, res, async () => {
      const health = await this.service.getHealth();
      res.json(health);
    });
  }

  async getDbHealth(req, res) {
    return this.handleRequest(req, res, async () => {
      try {
        const health = await this.service.getDbHealth();
        res.json(health);
      } catch (err) {
        res.status(500).json({ status: 'unhealthy', error: err.message });
      }
    });
  }
}

class DevController extends BaseController {
  constructor(service, errorHandler, logger) {
    super(service, errorHandler, logger);
  }

  async index(req, res) {
    return this.handleRequest(req, res, async () => {
      const metadata = await this.service.getInstanceMetadata();
      const health = await this.service.getHealth();
      const dbHealth = await this.service.getDbHealth();

      const recentUsers = await this.service.prisma.user.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          userRoles: {
            include: {
              role: true
            }
          }
        }
      });

      const recentMicroposts = await this.service.prisma.micropost.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              email: true
            }
          }
        }
      });

      res.render('dev/index', {
        title: '開発支援機能',
        path: req.path,
        metadata,
        health,
        dbHealth,
        recentUsers,
        recentMicroposts
      });
    });
  }

  async quickLogin(req, res) {
    return this.handleRequest(req, res, async () => {
      const { email } = req.params;
      const user = await this.service.prisma.user.findUnique({
        where: { email },
        include: {
          userRoles: {
            include: {
              role: true
            }
          }
        }
      });

      if (!user) {
        return this.errorHandler.handleNotFoundError(req, res, 'ユーザーが見つかりません');
      }

      await new Promise((resolve, reject) => {
        req.logIn(user, (err) => err ? reject(err) : resolve());
      });

      const isAdmin = user.userRoles.some(ur => ur.role.name === 'admin');
      const userType = isAdmin ? '管理者' : '一般ユーザー';

      this.sendResponse(req, res, {
        message: `${userType}としてログインしました`,
        redirectUrl: '/dev'
      });
    });
  }
}

class AdminController extends BaseController {
  constructor(services, errorHandler, logger) {
    super(errorHandler, logger);
    this.services = services;
  }

  async dashboard(req, res) {
    const stats = await this.services.system.getStats();
    res.render('admin/dashboard', {
      title: '管理者ダッシュボード',
      path: req.path,
      stats
    });
  }

  async manageUser(req, res) {
    const users = await this.services.profile.getAllUsers();
    res.render('admin/manage-user', {
      title: 'ユーザー管理',
      path: req.path,
      users
    });
  }

  async showUser(req, res) {
    const userId = parseInt(req.params.id, 10);
    const user = await this.services.profile.getUserProfile(userId);
    const microposts = await this.services.micropost.getMicropostsByUser(userId);

    res.render('admin/user-detail', {
      title: 'ユーザー詳細',
      path: req.path,
      user,
      microposts
    });
  }

  async updateUserRoles(req, res) {
    const userId = parseInt(req.params.id, 10);
    const roles = Array.isArray(req.body.roles) ? req.body.roles : [];

    try {
      await this.services.profile.updateUserRoles(userId, roles);
      req.flash('success', 'ユーザーの権限を更新しました');
    } catch (error) {
      this.logger.error('Failed to update user roles:', error);
      req.flash('error', 'ユーザーの権限更新に失敗しました');
    }

    res.redirect(`/admin/manage-user/${userId}`);
  }
}

class CategoryController extends BaseController {
  constructor(services, errorHandler, logger) {
    super(errorHandler, logger);
    this.categoryService = services.category;
  }

  async index(req, res) {
    return this.handleRequest(req, res, async () => {
      const categories = await this.categoryService.getAllCategories();
      res.render('categories/index', {
        categories,
        title: 'カテゴリー一覧',
        path: req.path
      });
    });
  }

  async show(req, res) {
    return this.handleRequest(req, res, async () => {
      const category = await this.categoryService.getCategoryById(req.params.id);
      if (!category) {
        return this.errorHandler.handleNotFoundError(req, res, 'カテゴリーが見つかりません');
      }
      res.render('categories/show', {
        category,
        title: `カテゴリー: ${category.name}`,
        path: req.path
      });
    });
  }
}

module.exports = {
  AuthController,
  ProfileController,
  MicropostController,
  SystemController,
  DevController,
  AdminController,
  CategoryController
}; 