const path = require('path');

class BaseController {
  constructor(services, errorHandler, logger) {
    this.services = services;
    this.errorHandler = errorHandler;
    this.logger = logger;
  }

  async handleRequest(req, res, handler) {
    try {
      this.logger.debug('Request handling started', {
        method: req.method,
        path: req.path,
        params: req.params,
        query: req.query,
        user: req.user ? { id: req.user.id } : null
      });

      return await handler();
    } catch (error) {
      this.logger.error('Unhandled error in request', {
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack
        },
        request: {
          method: req.method,
          path: req.path,
          params: req.params,
          query: req.query
        },
        user: req.user ? { id: req.user.id } : null
      });

      // Prismaのエラーをより詳細にログ出力
      if (error.code && error.meta) {
        this.logger.error('Prisma error details', {
          code: error.code,
          meta: error.meta,
          target: error.target
        });
      }

      // エラーの種類に応じて適切なハンドリング
      if (error.name === 'NotFoundError') {
        return this.errorHandler.handleNotFoundError(req, res, error.message);
      } else if (error.name === 'ValidationError') {
        return this.errorHandler.handleValidationError(req, res, error.message);
      } else if (error.name === 'PrismaClientValidationError') {
        return this.errorHandler.handleValidationError(req, res, 'データベースクエリが無効です');
      } else if (error.name === 'PrismaClientKnownRequestError') {
        return this.errorHandler.handleDatabaseError(req, res, 'データベース操作でエラーが発生しました');
      }

      // その他の予期せぬエラー
      return this.errorHandler.handleInternalError(req, res, error);
    }
  }

  renderWithUser(req, res, view, options = {}) {
    const defaultOptions = {
      user: req.user,
      path: req.path
    };
    res.render(view, { ...defaultOptions, ...options });
  }

  sendResponse(req, res, { status = 200, success = true, message = '', data = null, redirectUrl = null }) {
    const isApiRequest = req.xhr || 
                        req.headers.accept?.toLowerCase().includes('application/json') ||
                        req.headers['x-requested-with']?.toLowerCase() === 'xmlhttprequest';

    this.logger.debug('Sending response', {
      status,
      success,
      message,
      isApiRequest,
      redirectUrl,
      path: req.path
    });

    if (isApiRequest) {
      return res.status(status).json({
        success,
        message,
        data,
        redirectUrl
      });
    }

    if (message) {
      const flashType = success ? 'success' : 'error';
      req.flash(flashType, message);
    }

    if (redirectUrl) {
      return res.redirect(redirectUrl);
    }

    // リダイレクトURLが指定されていない場合は、元のページにリダイレクト
    return res.redirect('back');
  }
}

class AuthController extends BaseController {
  constructor(services, errorHandler, logger) {
    super(services, errorHandler, logger);
    
    // 必要なサービスの存在確認
    const requiredServices = ['auth', 'profile'];
    const missingServices = requiredServices.filter(service => !services[service]);
    
    if (missingServices.length > 0) {
      throw new Error(`Missing required services for AuthController: ${missingServices.join(', ')}`);
    }

    this.authService = services.auth;
    this.profileService = services.profile;
  }

  async getLoginPage(req, res) {
    return this.handleRequest(req, res, async () => {
      this.logger.debug('Login Page Debug [Start]', {
        method: req.method,
        path: req.path,
        headers: req.headers,
        cookies: req.cookies,
        session: req.session
      });

      const renderOptions = {
        title: 'ログイン',
        path: req.path,
        layout: 'layouts/auth'
      };

      this.logger.debug('Login Page Debug [End]', {
        renderOptions
      });

      return res.render('pages/auth/login', renderOptions);
    });
  }

  getSignupPage(req, res) {
    return this.handleRequest(req, res, async () => {
      this.renderWithUser(req, res, 'pages/auth/signup', { 
        title: 'ユーザー登録'
      });
    });
  }

  async signup(req, res) {
    return this.handleRequest(req, res, async () => {
      const { email, password, name, terms, roles } = req.body;
      const user = await this.authService.signup({ 
        email, 
        password, 
        name, 
        terms,
        roles: roles ? (Array.isArray(roles) ? roles : [roles]) : ['user']
      });
      await new Promise((resolve, reject) => {
        req.logIn(user, (err) => err ? reject(err) : resolve());
      });

      this.logger.info('User signup successful', {
        userId: user.id,
        email: user.email
      });

      return this.sendResponse(req, res, {
        success: true,
        message: 'ユーザー登録が完了しました',
        redirectUrl: '/',
        data: { userId: user.id }
      });
    });
  }

  async login(req, res) {
    return this.handleRequest(req, res, async () => {
      try {
        const { email, password } = req.body;
        
        if (!email || !password) {
          this.logger.warn('Login failed: Missing credentials');
          req.flash('error', 'メールアドレスとパスワードを入力してください');
          return res.redirect('/auth/login');
        }

        try {
          const user = await this.authService.authenticate(email, password);

          await new Promise((resolve, reject) => {
            req.logIn(user, (err) => {
              if (err) {
                console.error('Login session error:', err);
                reject(err);
              }
              resolve();
            });
          });

          const isApiRequest = req.xhr || 
                             req.headers.accept?.toLowerCase().includes('application/json') ||
                             req.headers['x-requested-with']?.toLowerCase() === 'xmlhttprequest';

          if (isApiRequest) {
            return this.sendResponse(req, res, {
              success: true,
              message: 'ログインしました',
              redirectUrl: '/'
            });
          }

          return res.redirect('/');
        } catch (error) {
          console.error('Authentication error:', {
            error: error.message,
            stack: error.stack,
            type: error.constructor.name
          });

          req.flash('error', 'メールアドレスまたはパスワードが正しくありません');
          return res.redirect('/auth/login');
        }
      } catch (error) {
        console.error('Login handler error:', {
          error: error.message,
          stack: error.stack,
          type: error.constructor.name
        });
        throw error;
      }
    });
  }

  async logout(req, res) {
    return this.handleRequest(req, res, async () => {
      try {
        const userId = req.user?.id;
        await this.authService.logout(req);

        this.logger.info('User logout successful', { userId });

        res.clearCookie('connect.sid', {
          path: '/',
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict'
        });

        const isApiRequest = req.xhr || 
                           req.headers.accept?.toLowerCase().includes('application/json') ||
                           req.headers['x-requested-with']?.toLowerCase() === 'xmlhttprequest';

        if (isApiRequest) {
          return this.sendResponse(req, res, {
            success: true,
            message: 'ログアウトしました',
            redirectUrl: '/auth/login'
          });
        }

        req.flash('success', 'ログアウトしました');
        return res.redirect('/auth/login');
      } catch (error) {
        this.logger.error('Logout failed', {
          error: error.message,
          userId: req.user?.id
        });
        throw error;
      }
    });
  }

  async getSession(req, res) {
    return this.handleRequest(req, res, async () => {
      const user = req.user;
      const roles = user.userRoles.map(ur => ur.role.name);

      return res.status(200).json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          roles: roles
        }
      });
    });
  }
}

class MicropostController extends BaseController {
  constructor(micropostService, likeService, commentService, errorHandler, logger) {
    super({ micropost: micropostService, like: likeService, comment: commentService }, errorHandler, logger);
    
    if (!micropostService || !likeService || !commentService) {
      throw new Error('Required services are not initialized in MicropostController');
    }

    this.micropostService = micropostService;
    this.likeService = likeService;
    this.commentService = commentService;
  }

  async index(req, res) {
    return this.handleRequest(req, res, async () => {
      const [microposts, categories] = await Promise.all([
        this.services.micropost.getAllMicroposts(),
        this.services.micropost.prisma.category.findMany({
          orderBy: { name: 'asc' },
          include: {
            _count: {
              select: {
                microposts: true
              }
            }
          }
        })
      ]);

      const isApiRequest = req.xhr || 
        req.headers.accept?.includes('application/json') || 
        req.headers['content-type']?.includes('application/json');

      if (isApiRequest) {
        return res.json({
          success: true,
          microposts: microposts
        });
      }

      return this.renderWithUser(req, res, 'pages/public/microposts/index', {
        title: '投稿一覧',
        microposts: microposts,
        categories: categories
      });
    });
  }

  async show(req, res) {
    return this.handleRequest(req, res, async () => {
      const { id } = req.params;
      const micropost = await this.services.micropost.getMicropost(id);

      if (!micropost) {
        return this.errorHandler.handleNotFoundError(req, res, '投稿が見つかりません');
      }

      const isApiRequest = req.xhr || 
        req.headers.accept?.includes('application/json') || 
        req.headers['content-type']?.includes('application/json');

      if (isApiRequest) {
        return res.json({
          success: true,
          micropost: {
            ...micropost,
            likeCount: micropost.likeCount,
            likedUsers: micropost.likedUsers
          }
        });
      }

      return this.renderWithUser(req, res, 'pages/public/microposts/show', {
        title: '投稿詳細',
        micropost,
        likeCount: micropost.likeCount,
        likedUsers: micropost.likedUsers
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

      const micropost = await this.micropostService.createMicropost({
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
  constructor(services, errorHandler, logger) {
    super(services, errorHandler, logger);
    
    const requiredServices = ['profile', 'follow'];
    const missingServices = requiredServices.filter(service => !services[service]);
    
    if (missingServices.length > 0) {
      throw new Error(`Missing required services for ProfileController: ${missingServices.join(', ')}`);
    }

    this.profileService = services.profile;
    this.followService = services.follow;
    this.micropostService = services.micropost;
  }

  async show(req, res) {
    return this.handleRequest(req, res, async () => {
      console.log('=== Profile Controller Debug ===');
      console.log('Request params:', req.params);
      console.log('Username:', req.params.username);
      console.log('Accept header:', req.headers.accept);
      
      const user = await this.profileService.getUserProfileByName(req.params.username);
      console.log('Found user:', user);
      
      if (!user) {
        console.log('User not found');
        return this.errorHandler.handleNotFoundError(req, res, 'ユーザーが見つかりません');
      }

      const followCounts = await this.profileService.getFollowCounts(user.id);
      const viewData = {
        title: `${user.name}のプロフィール`,
        profileUser: user,
        userProfile: user.profile,
        followCounts,
        microposts: []
      };

      // マイクロポストの取得は任意
      if (this.micropostService?.getMicropostsByUserId) {
        viewData.microposts = await this.micropostService.getMicropostsByUserId(user.id);
      }

      if (req.user) {
        viewData.isFollowing = await this.followService.isFollowing(req.user.id, user.id);
      }

      const isApiRequest = req.xhr || 
        req.headers.accept?.includes('application/json') || 
        req.headers['content-type']?.includes('application/json');

      console.log('Is API request:', isApiRequest);

      if (isApiRequest) {
        return res.json({
          success: true,
          profile: {
            user: {
              id: user.id,
              name: user.name,
              email: user.email,
              profile: user.profile
            },
            followCounts,
            microposts: viewData.microposts,
            isFollowing: viewData.isFollowing
          }
        });
      }

      return this.renderWithUser(req, res, 'pages/public/users/profile/show', viewData);
    });
  }

  async getEditPage(req, res) {
    return this.handleRequest(req, res, async () => {
      let user;
      let userId;

      if (req.params.id.match(/^[0-9]+$/)) {
        userId = parseInt(req.params.id, 10);
        user = await this.services.profile.getUserProfile(userId);
      } else {
        user = await this.services.profile.getUserProfileByName(req.params.id);
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

      this.renderWithUser(req, res, 'pages/public/users/profile/edit', {
        title: 'プロフィール編集',
        profileUser: user,
        userProfile: user.profile,
        req: req
      });
    });
  }

  async update(req, res) {
    return this.handleRequest(req, res, async () => {
      let user;
      let userId;

      if (req.params.id.match(/^[0-9]+$/)) {
        userId = parseInt(req.params.id, 10);
        user = await this.services.profile.getUserProfile(userId);
      } else {
        user = await this.services.profile.getUserProfileByName(req.params.id);
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
        avatarPath = req.file.filename || path.basename(req.file.path);
      }

      const updatedUser = await this.services.profile.updateProfile(userId, {
        ...req.body,
        avatarPath
      });
      
      this.sendResponse(req, res, {
        message: 'プロフィールを更新しました',
        redirectUrl: `/profile/${updatedUser.name}`
      });
    });
  }

  async follow(req, res) {
    return this.handleRequest(req, res, async () => {
      if (!req.user) {
        this.logger.warn('Follow attempt without authentication');
        return res.status(403).json({
          success: false,
          message: 'ログインが必要です'
        });
      }

      const targetUserId = parseInt(req.params.id, 10);
      
      if (isNaN(targetUserId)) {
        this.logger.warn('Invalid target user ID:', req.params.id);
        return res.status(400).json({
          success: false,
          message: '無効なユーザーIDです'
        });
      }

      this.logger.debug('Follow request:', {
        followerId: req.user.id,
        targetUserId,
        path: req.path
      });

      try {
        const targetUser = await this.profileService.getUserProfile(targetUserId);

        if (!targetUser) {
          this.logger.warn('Target user not found:', targetUserId);
          return res.status(404).json({
            success: false,
            message: 'ユーザーが見つかりません'
          });
        }

        if (req.user.id === targetUserId) {
          this.logger.warn('User attempted to follow themselves:', req.user.id);
          return res.status(400).json({
            success: false,
            message: '自分自身をフォローすることはできません'
          });
        }

        await this.followService.follow(req.user.id, targetUserId);
        const followCounts = await this.followService.getFollowCounts(targetUserId);

        return res.status(200).json({
          success: true,
          message: 'フォローしました',
          data: { followCounts }
        });
      } catch (error) {
        this.logger.error('Follow failed:', {
          error: error.message,
          stack: error.stack,
          followerId: req.user.id,
          targetUserId
        });

        if (error.code === 'P2002') {
          return res.status(400).json({
            success: false,
            message: 'すでにフォローしています'
          });
        }

        return res.status(500).json({
          success: false,
          message: 'フォロー操作に失敗しました'
        });
      }
    });
  }

  async unfollow(req, res) {
    return this.handleRequest(req, res, async () => {
      if (!req.user) {
        this.logger.warn('Unfollow attempt without authentication');
        return res.status(403).json({
          success: false,
          message: 'ログインが必要です'
        });
      }

      const targetUserId = parseInt(req.params.id, 10);
      
      if (isNaN(targetUserId)) {
        this.logger.warn('Invalid target user ID:', req.params.id);
        return res.status(400).json({
          success: false,
          message: '無効なユーザーIDです'
        });
      }

      this.logger.debug('Unfollow request:', {
        followerId: req.user.id,
        targetUserId,
        path: req.path
      });

      try {
        const targetUser = await this.profileService.getUserProfile(targetUserId);

        if (!targetUser) {
          this.logger.warn('Target user not found:', targetUserId);
          return res.status(404).json({
            success: false,
            message: 'ユーザーが見つかりません'
          });
        }

        if (req.user.id === targetUserId) {
          this.logger.warn('User attempted to unfollow themselves:', req.user.id);
          return res.status(400).json({
            success: false,
            message: '自分自身のフォローを解除することはできません'
          });
        }

        await this.followService.unfollow(req.user.id, targetUserId);
        const followCounts = await this.followService.getFollowCounts(targetUserId);

        return res.status(200).json({
          success: true,
          message: 'フォロー解除しました',
          data: { followCounts }
        });
      } catch (error) {
        this.logger.error('Unfollow failed:', {
          error: error.message,
          stack: error.stack,
          followerId: req.user.id,
          targetUserId
        });

        if (error.code === 'P2025') {
          return res.status(400).json({
            success: false,
            message: 'フォローしていません'
          });
        }

        return res.status(500).json({
          success: false,
          message: 'フォロー解除に失敗しました'
        });
      }
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
      
      const profileUser = await this.services.profile.findUserByIdentifier(identifier);

      if (!profileUser) {
        this.logger.debug('Profile not found:', { identifier });
        return this.errorHandler.handleNotFoundError(req, res, 'ユーザーが見つかりません');
      }

      this.logger.debug('Found profile user:', {
        id: profileUser.id,
        name: profileUser.name
      });

      const following = await this.services.profile.getFollowing(profileUser.id);
      const followCounts = await this.services.profile.getFollowCounts(profileUser.id);

      // 現在のユーザーが各フォロー中ユーザーをフォローしているかどうかを確認
      let followingWithStatus = following.map(f => ({
        ...f,
        isFollowing: false
      }));

      if (req.user) {
        const followingStatuses = await Promise.all(
          following.map(f => 
            this.services.profile.isFollowing(req.user.id, f.following.id)
          )
        );
        followingWithStatus = following.map((f, i) => ({
          ...f,
          isFollowing: followingStatuses[i]
        }));
      }

      this.logger.debug('Following data:', {
        followingCount: following.length,
        followCounts
      });

      this.renderWithUser(req, res, 'pages/public/users/following', {
        profileUser,
        following: followingWithStatus.map(f => ({
          ...f.following,
          isFollowing: f.isFollowing
        })),
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
      
      const profileUser = await this.services.profile.findUserByIdentifier(identifier);

      if (!profileUser) {
        this.logger.debug('Profile not found:', { identifier });
        return this.errorHandler.handleNotFoundError(req, res, 'ユーザーが見つかりません');
      }

      this.logger.debug('Found profile user:', {
        id: profileUser.id,
        name: profileUser.name
      });

      const followers = await this.services.profile.getFollowers(profileUser.id);
      const followCounts = await this.services.profile.getFollowCounts(profileUser.id);

      // 現在のユーザーが各フォロワーをフォローしているかどうかを確認
      let followersWithStatus = followers.map(f => ({
        ...f,
        isFollowing: false
      }));

      if (req.user) {
        const followingStatuses = await Promise.all(
          followers.map(f => 
            this.services.profile.isFollowing(req.user.id, f.follower.id)
          )
        );
        followersWithStatus = followers.map((f, i) => ({
          ...f,
          isFollowing: followingStatuses[i]
        }));
      }

      this.logger.debug('Followers data:', {
        followersCount: followers.length,
        followCounts
      });

      this.renderWithUser(req, res, 'pages/public/users/followers', {
        profileUser,
        followers: followersWithStatus.map(f => ({
          ...f.follower,
          isFollowing: f.isFollowing
        })),
        followCounts,
        title: `${profileUser.name}のフォロワー`
      });
    });
  }
}

class SystemController extends BaseController {
  constructor(systemService, errorHandler, logger) {
    super({ system: systemService }, errorHandler, logger);
    this.systemService = systemService;
  }

  getHealth = async (req, res) => {
    return this.handleRequest(req, res, async () => {
      const healthStatus = await this.systemService.getHealth();
      return res.status(200).json(healthStatus);
    });
  };

  async getDbHealth(req, res) {
    return this.handleRequest(req, res, async () => {
      try {
        const health = await this.systemService.getDbHealth();
        res.json(health);
      } catch (err) {
        res.status(500).json({ status: 'unhealthy', error: err.message });
      }
    });
  }
}

class DevelopmentToolsController extends BaseController {
  constructor(services, errorHandler, logger) {
    super(services, errorHandler, logger);
    
    // 必要なサービスの存在確認
    const requiredServices = ['system', 'profile', 'micropost'];
    const missingServices = requiredServices.filter(service => !services[service]);
    
    if (missingServices.length > 0) {
      throw new Error(`Missing required services for DevelopmentToolsController: ${missingServices.join(', ')}`);
    }

    this.systemService = services.system;
    this.profileService = services.profile;
    this.micropostService = services.micropost;
  }

  async index(req, res) {
    return this.handleRequest(req, res, async () => {
      this.logger.debug('Development Tools Debug [Start]', {
        method: req.method,
        path: req.path,
        headers: req.headers,
        cookies: req.cookies,
        session: req.session
      });

      const [health, dbHealth, recentUsers, recentMicroposts] = await Promise.all([
        this.systemService.getHealth(),
        this.systemService.getDbHealth(),
        this.profileService.getAllUsers(),
        this.micropostService.getAllMicroposts()
      ]);

      const renderOptions = {
        title: '開発支援機能',
        path: req.path,
        health,
        dbHealth,
        recentUsers,
        recentMicroposts,
        layout: 'layouts/dev'
      };

      this.logger.debug('Development Tools Debug [End]', {
        renderOptions: {
          ...renderOptions,
          recentUsers: `[Array(${recentUsers.length})]`,
          recentMicroposts: `[Array(${recentMicroposts.length})]`
        }
      });

      return res.render('pages/development-tools/index', renderOptions);
    });
  }

  async quickLogin(req, res) {
    return this.handleRequest(req, res, async () => {
      const { email } = req.params;
      
      if (!email) {
        throw new Error('メールアドレスが指定されていません');
      }

      const user = await this.profileService.findUserByIdentifier(email);

      if (!user) {
        throw new Error('ユーザーが見つかりません');
      }

      await new Promise((resolve, reject) => {
        req.logIn(user, (err) => err ? reject(err) : resolve());
      });

      return this.sendResponse(req, res, {
        success: true,
        message: 'クイックログインが完了しました',
        redirectUrl: '/',
        data: { userId: user.id }
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
    res.render('pages/admin/dashboard', {
      title: '管理者ダッシュボード',
      path: req.path,
      stats
    });
  }

  async manageUsers(req, res) {
    const users = await this.services.profile.getAllUsers();
    res.render('pages/admin/users/index', {
      title: 'ユーザー管理',
      path: req.path,
      users
    });
  }

  async showUser(req, res) {
    const { id } = req.params;
    const user = await this.services.profile.getUserProfile(id);
    if (!user) {
      req.flash('error', 'ユーザーが見つかりません');
      return res.redirect('/admin/users');
    }

    const microposts = await this.services.micropost.getMicropostsByUser(id);

    res.render('pages/admin/users/show', { 
      user,
      microposts,
      title: 'ユーザー詳細',
      path: req.path
    });
  }

  async updateUserRoles(req, res) {
    const { id: userId } = req.params;
    const { roles } = req.body;

    try {
      await this.services.profile.updateUserRoles(userId, roles || []);
      req.flash('success', 'ユーザーロールを更新しました');
    } catch (error) {
      req.flash('error', error.message);
    }

    res.redirect(`/admin/users/${userId}`);
  }
}

class CategoryController extends BaseController {
  constructor(categoryService, errorHandler, logger) {
    super({ category: categoryService }, errorHandler, logger);
    this.categoryService = categoryService;
    
    if (!this.logger) {
      throw new Error('Logger is not initialized in CategoryController');
    }
  }

  async index(req, res) {
    return this.handleRequest(req, res, async () => {
      this.logger.info('Starting category index request', {
        path: req.path,
        query: req.query
      });

      try {
        const categories = await this.categoryService.getAllCategories();
        
        // データを整形
        const formattedCategories = categories.map(category => ({
          id: category.id,
          name: category.name,
          description: category.description,
          micropostsCount: category._count.microposts,
          recentMicroposts: category.microposts
            .slice(0, 5)
            .map(mc => ({
              id: mc.micropost.id,
              title: mc.micropost.title,
              user: mc.micropost.user,
              stats: {
                likes: mc.micropost._count.likes,
                comments: mc.micropost._count.comments,
                views: mc.micropost._count.views
              }
            }))
        }));

        this.logger.info('Category index processed successfully', {
          count: formattedCategories.length,
          categories: formattedCategories.map(c => ({
            id: c.id,
            name: c.name,
            postsCount: c.micropostsCount
          }))
        });

        res.render('pages/public/categories/index', {
          categories: formattedCategories,
          title: 'カテゴリー一覧',
          path: req.path,
          user: req.user
        });
      } catch (error) {
        this.logger.error('Error in category index', {
          error: error.message,
          stack: error.stack,
          path: req.path
        });
        throw error;
      }
    });
  }

  async show(req, res) {
    return this.handleRequest(req, res, async () => {

      try {
        const categoryId = parseInt(req.params.id, 10);
        if (isNaN(categoryId)) {
          console.error('Invalid category ID:', req.params.id);
          return this.errorHandler.handleNotFoundError(req, res, 'カテゴリーが見つかりません');
        }

        const category = await this.categoryService.getCategoryById(categoryId);
        if (!category) {
          console.warn('Category not found:', categoryId);
          return this.errorHandler.handleNotFoundError(req, res, 'カテゴリーが見つかりません');
        }

        // ビューの期待する形式に整形
        const formattedCategory = {
          id: category.id,
          name: category.name,
          description: category.description,
          microposts: category.microposts.map(mc => ({
            micropost: {
              id: mc.micropost.id,
              title: mc.micropost.title,
              content: mc.micropost.content,
              user: mc.micropost.user,
              createdAt: mc.micropost.createdAt,
              imageUrl: mc.micropost.imageUrl
            }
          }))
        };


        res.render('pages/public/categories/show', {
          category: formattedCategory,
          title: `${formattedCategory.name}の投稿一覧`,
          path: req.path,
          user: req.user
        });
      } catch (error) {
        console.error('Show error:', error);
        throw error;
      }
    });
  }

  async listCategories(req, res) {
    return this.handleRequest(req, res, async () => {
      this.logger.info('Starting categories API request', {
        path: req.path,
        query: req.query
      });

      try {
        const categories = await this.categoryService.getAllCategories();
        
        const formattedCategories = categories.map(category => ({
          id: category.id,
          name: category.name,
          description: category.description,
          micropostsCount: category._count.microposts
        }));

        this.logger.info('Categories API processed successfully', {
          count: formattedCategories.length,
          path: req.path
        });

        res.json({
          success: true,
          data: formattedCategories
        });
      } catch (error) {
        this.logger.error('Error in categories API', {
          error: error.message,
          stack: error.stack,
          path: req.path
        });
        throw error;
      }
    });
  }
}

class LikeController extends BaseController {
  constructor(services, errorHandler, logger) {
    super(services, errorHandler, logger);
  }

  async getLikedUsers(req, res) {
    try {
      const { id } = req.params;
      this.logger.debug('Getting liked users', { 
        micropostId: id,
        path: req.path,
        method: req.method
      });

      const users = await this.services.like.getLikedUsers(id);
      
      this.logger.debug('Liked users response', { 
        micropostId: id,
        userCount: users.length,
        users: users.map(user => ({
          id: user.id,
          name: user.name
        }))
      });

      return this.success(res, { likes: users });
    } catch (error) {
      this.logger.error('Error in getLikedUsers controller', {
        error: error.message,
        stack: error.stack,
        params: req.params
      });
      return this.handleError(error, res);
    }
  }

  async getLikeCount(req, res) {
    try {
      const { id } = req.params;
      this.logger.debug('Getting like count', { 
        micropostId: id,
        path: req.path,
        method: req.method
      });

      const count = await this.services.like.getLikeCount(id);
      
      this.logger.debug('Like count response', { 
        micropostId: id,
        count
      });

      return this.success(res, { count });
    } catch (error) {
      this.logger.error('Error in getLikeCount controller', {
        error: error.message,
        stack: error.stack,
        params: req.params
      });
      return this.handleError(error, res);
    }
  }
}

class CommentController extends BaseController {
  constructor(services, errorHandler, logger) {
    super(services, errorHandler, logger);
    this.commentService = services.comment;
  }

  async index(req, res) {
    return this.handleRequest(req, res, async () => {
      const micropostId = parseInt(req.params.micropostId, 10);
      const comments = await this.commentService.getCommentsByMicropostId(micropostId);
      
      return res.status(200).json({
        success: true,
        comments
      });
    });
  }

  async create(req, res) {
    return this.handleRequest(req, res, async () => {
      const { content } = req.body;
      const userId = req.user.id;
      const micropostId = parseInt(req.params.micropostId, 10);

      const comment = await this.commentService.createComment({
        content,
        userId,
        micropostId
      });

      return this.sendResponse(req, res, {
        success: true,
        message: 'コメントを投稿しました',
        data: { comment }
      });
    });
  }
}

class NotificationController extends BaseController {
  constructor(services, errorHandler, logger) {
    super(services, errorHandler, logger);
    this.notificationService = services.notification;
  }

  async index(req, res) {
    return this.handleRequest(req, res, async () => {
      if (!req.user) {
        return this.errorHandler.handlePermissionError(req, res, 'ログインが必要です');
      }

      const notifications = await this.notificationService.getNotifications(req.user.id);

      res.render('pages/public/notifications/index', {
        notifications,
        title: '通知一覧',
        user: req.user,
        path: req.path
      });
    });
  }

  async markAsRead(req, res) {
    return this.handleRequest(req, res, async () => {
      if (!req.user) {
        return this.errorHandler.handlePermissionError(req, res, 'ログインが必要です');
      }

      await this.notificationService.markAsRead(parseInt(req.params.id), req.user.id);
      
      this.sendResponse(req, res, {
        status: 200,
        success: true
      });
    });
  }
}

module.exports = (services, errorHandler, logger) => {
  if (!services) {
    throw new Error('Services object is required');
  }

  // 必要なサービスの存在確認
  const requiredServices = ['auth', 'profile', 'micropost', 'system'];
  const missingServices = requiredServices.filter(service => !services[service]);
  
  if (missingServices.length > 0) {
    throw new Error(`Missing required services: ${missingServices.join(', ')}`);
  }

  // 各コントローラーのインスタンス化
  const controllers = {
    auth: new AuthController(services, errorHandler, logger),
    profile: new ProfileController(services, errorHandler, logger),
    micropost: new MicropostController(services.micropost, services.like, services.comment, errorHandler, logger),
    system: new SystemController(services.system, errorHandler, logger),
    developmentTools: new DevelopmentToolsController(services, errorHandler, logger),
    admin: new AdminController(services, errorHandler, logger),
    category: new CategoryController(services.category, errorHandler, logger),
    like: new LikeController(services, errorHandler, logger),
    comment: new CommentController(services, errorHandler, logger),
    notification: new NotificationController(services, errorHandler, logger)
  };

  // 各コントローラーの初期化確認
  Object.entries(controllers).forEach(([name, controller]) => {
    if (!controller) {
      throw new Error(`Failed to initialize ${name} controller`);
    }
  });

  return controllers;
}; 