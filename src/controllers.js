const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const axios = require('axios');
const passport = require('passport');
const prisma = new PrismaClient();

// Constants for common values
const CONSTANTS = {
  DEFAULT_PAGE_SIZE: 10,
  RESPONSE_TYPES: {
    JSON: 'application/json',
    HTML: 'text/html'
  },
  FLASH_TYPES: {
    SUCCESS: 'success',
    ERROR: 'error',
    INFO: 'info'
  },
  USER_TYPES: {
    ADMIN: 'admin',
    USER: 'user'
  }
};

// Common response utilities
const ResponseUtils = {
  isApiRequest(req) {
    return req.xhr || req.headers.accept?.includes(CONSTANTS.RESPONSE_TYPES.JSON);
  },

  sendSuccessResponse(req, res, { status = 200, message, data, redirectUrl }) {
    if (this.isApiRequest(req)) {
      return res.status(status).json({
        success: true,
        message,
        data
      });
    }
    if (message) {
      req.flash(CONSTANTS.FLASH_TYPES.SUCCESS, message);
    }
    return res.redirect(redirectUrl);
  },

  sendErrorResponse(req, res, { status = 400, message, error }) {
    if (this.isApiRequest(req)) {
      return res.status(status).json({
        success: false,
        message,
        error
      });
    }
    if (message) {
      req.flash(CONSTANTS.FLASH_TYPES.ERROR, message);
    }
    return res.redirect('back');
  }
};

// Common validation utilities
const ValidationUtils = {
  validateRequired(value, fieldName) {
    if (!value?.trim()) {
      throw new ValidationError(`${fieldName}を入力してください`, {
        code: 'EMPTY_FIELD',
        field: fieldName,
        value,
        constraint: 'required'
      });
    }
    return value.trim();
  },

  validateUserAccess(currentUser, targetUserId, isAdminRequired = false) {
    const isOwnResource = currentUser.id === parseInt(targetUserId, 10);
    const isAdmin = currentUser.userRoles.some(ur => ur.role.name === CONSTANTS.USER_TYPES.ADMIN);
    
    if (isAdminRequired && !isAdmin) {
      throw new PermissionError('管理者権限が必要です');
    }
    
    if (!isOwnResource && !isAdmin) {
      throw new PermissionError('アクセス権限がありません');
    }
    
    return true;
  }
};

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
      this.logger.error('Request handling error:', {
        error: error.message,
        stack: error.stack,
        path: req.path
      });
      this.errorHandler.handle(error, req, res);
    }
  }

  renderWithUser(req, res, view, options = {}) {
    const defaultOptions = {
      user: req.user,
      path: req.path,
      flash: {
        success: req.flash(CONSTANTS.FLASH_TYPES.SUCCESS),
        error: req.flash(CONSTANTS.FLASH_TYPES.ERROR),
        info: req.flash(CONSTANTS.FLASH_TYPES.INFO)
      }
    };
    res.render(view, { ...defaultOptions, ...options });
  }

  async ensureAuthenticated(req) {
    if (!req.user) {
      throw new AuthenticationError('ログインが必要です');
    }
    return req.user;
  }

  async loginUser(req, user) {
    return new Promise((resolve, reject) => {
      req.logIn(user, (err) => err ? reject(err) : resolve());
    });
  }
}

class AuthController extends BaseController {
  constructor(service, errorHandler, logger) {
    super(service, errorHandler, logger);
  }

  getSignupPage(req, res) {
    return this.handleRequest(req, res, async () => {
      this.renderWithUser(req, res, 'pages/auth/signup', { 
        title: 'ユーザー登録'
      });
    });
  }

  getLoginPage(req, res) {
    return this.handleRequest(req, res, async () => {
      this.renderWithUser(req, res, 'pages/auth/login', { 
        title: 'ログイン'
      });
    });
  }

  async signup(req, res) {
    return this.handleRequest(req, res, async () => {
      const user = await this.service.signup(req.body);
      await this.loginUser(req, user);
      ResponseUtils.sendSuccessResponse(req, res, {
        message: 'ユーザー登録が完了しました',
        redirectUrl: '/'
      });
    });
  }

  async login(req, res) {
    return this.handleRequest(req, res, async () => {
      await this.service.login(req, res);
      ResponseUtils.sendSuccessResponse(req, res, {
        message: 'ログインしました',
        redirectUrl: '/'
      });
    });
  }

  async logout(req, res) {
    return this.handleRequest(req, res, async () => {
      try {
        await this.service.logout(req);
      } catch (error) {
        this.logger.error('Session destruction error:', error);
      }

      res.clearCookie('connect.sid', {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict'
      });
      
      if (ResponseUtils.isApiRequest(req)) {
        return res.status(200).json({
          success: true,
          message: 'ログアウトしました'
        });
      }
      
      return res.redirect('/auth/login');
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
      this.renderWithUser(req, res, 'pages/public/microposts/index', { 
        microposts,
        categories,
        title: '投稿一覧'
      });
    });
  }

  async create(req, res) {
    return this.handleRequest(req, res, async () => {
      const { title, categories } = req.body;
      if (!title?.trim()) {
        return ResponseUtils.sendErrorResponse(req, res, {
          status: 400,
          message: '投稿内容を入力してください',
          error: {
            code: 'EMPTY_CONTENT',
            field: 'title',
            value: title,
            constraint: 'required'
          }
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
      
      ResponseUtils.sendSuccessResponse(req, res, {
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

      this.renderWithUser(req, res, 'pages/public/users/profile/show', {
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

      res.render('pages/public/users/profile/edit', {
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

  async following(req, res) {
    return this.handleRequest(req, res, async () => {
      this.logger.debug('Following request:', {
        params: req.params,
        path: req.path,
        url: req.url,
        method: req.method
      });

      const identifier = req.params.id;
      this.logger.debug('Looking up user:', { identifier });
      
      const profileUser = await this.service.findUserByIdentifier(identifier);

      if (!profileUser) {
        this.logger.debug('Profile not found:', { identifier });
        return this.errorHandler.handleNotFoundError(req, res, 'ユーザーが見つかりません');
      }

      this.logger.debug('Found profile user:', {
        id: profileUser.id,
        name: profileUser.name
      });

      const following = await this.service.getFollowing(profileUser.id);
      const followCounts = await this.service.getFollowCounts(profileUser.id);

      this.logger.debug('Following data:', {
        followingCount: following.length,
        followCounts
      });

      this.renderWithUser(req, res, 'pages/public/users/following', {
        profileUser,
        following: following.map(f => f.following),
        followCounts,
        title: `${profileUser.name}のフォロー中`
      });
    });
  }

  async followers(req, res) {
    return this.handleRequest(req, res, async () => {
      this.logger.debug('Followers request:', {
        params: req.params,
        path: req.path,
        url: req.url,
        method: req.method
      });

      const identifier = req.params.id;
      this.logger.debug('Looking up user:', { identifier });
      
      const profileUser = await this.service.findUserByIdentifier(identifier);

      if (!profileUser) {
        this.logger.debug('Profile not found:', { identifier });
        return this.errorHandler.handleNotFoundError(req, res, 'ユーザーが見つかりません');
      }

      this.logger.debug('Found profile user:', {
        id: profileUser.id,
        name: profileUser.name
      });

      const followers = await this.service.getFollowers(profileUser.id);
      const followCounts = await this.service.getFollowCounts(profileUser.id);

      this.logger.debug('Followers data:', {
        followersCount: followers.length,
        followCounts
      });

      this.renderWithUser(req, res, 'pages/public/users/followers', {
        profileUser,
        followers: followers.map(f => f.follower),
        followCounts,
        title: `${profileUser.name}のフォロワー`
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

      res.render('pages/dev/index', {
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
        return ResponseUtils.sendErrorResponse(req, res, {
          status: 404,
          message: 'ユーザーが見つかりません'
        });
      }

      await this.loginUser(req, user);

      const isAdmin = user.userRoles.some(ur => ur.role.name === CONSTANTS.USER_TYPES.ADMIN);
      const userType = isAdmin ? '管理者' : '一般ユーザー';

      ResponseUtils.sendSuccessResponse(req, res, {
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
    return this.handleRequest(req, res, async () => {
      const stats = await this.services.system.getStats();
      this.renderWithUser(req, res, 'pages/admin/dashboard', {
        title: '管理者ダッシュボード',
        stats
      });
    });
  }

  async manageUsers(req, res) {
    return this.handleRequest(req, res, async () => {
      const users = await this.services.profile.getAllUsers();
      this.renderWithUser(req, res, 'pages/admin/users/index', {
        title: 'ユーザー管理',
        users
      });
    });
  }

  async showUser(req, res) {
    return this.handleRequest(req, res, async () => {
      const { id } = req.params;
      const user = await this.services.profile.getUserProfile(id);
      
      if (!user) {
        return ResponseUtils.sendErrorResponse(req, res, {
          status: 404,
          message: 'ユーザーが見つかりません',
          redirectUrl: '/admin/users'
        });
      }

      this.renderWithUser(req, res, 'pages/admin/users/show', { 
        user,
        title: 'ユーザー詳細'
      });
    });
  }

  async updateUserRoles(req, res) {
    return this.handleRequest(req, res, async () => {
      const { id: userId } = req.params;
      const { roles } = req.body;

      try {
        await this.services.profile.updateUserRoles(userId, roles || []);
        ResponseUtils.sendSuccessResponse(req, res, {
          message: 'ユーザーロールを更新しました',
          redirectUrl: `/admin/users/${userId}`
        });
      } catch (error) {
        ResponseUtils.sendErrorResponse(req, res, {
          message: error.message,
          redirectUrl: `/admin/users/${userId}`
        });
      }
    });
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
      this.renderWithUser(req, res, 'pages/public/categories/index', {
        categories,
        title: 'カテゴリー一覧'
      });
    });
  }

  async show(req, res) {
    return this.handleRequest(req, res, async () => {
      const category = await this.categoryService.getCategoryById(req.params.id);
      if (!category) {
        return ResponseUtils.sendErrorResponse(req, res, {
          status: 404,
          message: 'カテゴリーが見つかりません',
          redirectUrl: '/categories'
        });
      }

      this.renderWithUser(req, res, 'pages/public/categories/show', {
        category,
        title: `カテゴリー: ${category.name}`
      });
    });
  }
}

// Custom Error Classes
class ValidationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}

class PermissionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PermissionError';
  }
}

class AuthenticationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

module.exports = {
  AuthController,
  ProfileController,
  MicropostController,
  SystemController,
  DevController,
  AdminController,
  CategoryController,
  CONSTANTS,
  ResponseUtils,
  ValidationUtils
}; 