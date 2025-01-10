const express = require('express');
const path = require('path');
const asyncHandler = require('express-async-handler');

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
      const user = await this.services.signup(req.body);
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
        const user = await this.services.login(req, res);
        
        this.logger.info('User login successful', {
          userId: user.id,
          email: user.email
        });

        const isApiRequest = req.xhr || 
                           req.headers.accept?.toLowerCase().includes('application/json') ||
                           req.headers['x-requested-with']?.toLowerCase() === 'xmlhttprequest';

        const redirectUrl = req.session.returnTo || '/';
        delete req.session.returnTo;

        if (isApiRequest) {
          return this.sendResponse(req, res, {
            success: true,
            message: 'ログインしました',
            data: { userId: user.id },
            redirectUrl
          });
        }

        req.flash('success', 'ログインしました');
        return res.redirect(redirectUrl);
      } catch (error) {
        this.logger.error('Login failed', {
          error: error.message,
          email: req.body.email
        });

        const isApiRequest = req.xhr || 
                           req.headers.accept?.toLowerCase().includes('application/json') ||
                           req.headers['x-requested-with']?.toLowerCase() === 'xmlhttprequest';

        if (isApiRequest) {
          return this.sendResponse(req, res, {
            success: false,
            message: 'ログインに失敗しました',
            status: 401
          });
        }

        req.flash('error', 'ログインに失敗しました');
        return res.redirect('/auth/login');
      }
    });
  }

  async logout(req, res) {
    return this.handleRequest(req, res, async () => {
      try {
        const userId = req.user?.id;
        await this.services.logout(req);

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
}

class MicropostController extends BaseController {
  constructor(services, fileUploader, errorHandler, logger) {
    super(services, errorHandler, logger);
    this.fileUploader = fileUploader;
    this.micropostService = services.micropost;
    this.likeService = services.like;
    this.commentService = services.comment;
  }

  async index(req, res) {
    return this.handleRequest(req, res, async () => {

      try {
        const [microposts, categories] = await Promise.all([
          this.micropostService.getAllMicroposts(),
          this.micropostService.prisma.category.findMany({
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

        const micropostsWithLikes = await Promise.all(
          microposts.map(async (micropost) => {
            try {
              const [isLiked, likeCount] = await Promise.all([
                req.user ? this.likeService.isLiked(req.user.id, micropost.id) : false,
                this.likeService.getLikeCount(micropost.id)
              ]);
              return { ...micropost, isLiked, likeCount };
            } catch (error) {
              console.error('Error processing likes for micropost:', {
                micropostId: micropost.id,
                error: error.message
              });
              return { ...micropost, isLiked: false, likeCount: 0 };
            }
          })
        );

        try {
          res.render('pages/public/microposts/index', { 
            microposts: micropostsWithLikes,
            categories,
            title: '投稿一覧',
            path: req.path,
            user: req.user,
            csrfToken: res.locals.csrfToken,
            currentPage: 1,
            totalPages: 1
          });
        } catch (renderError) {
          console.error('Template rendering error:', {
            error: renderError.message,
            stack: renderError.stack,
            templatePath: 'pages/public/microposts/index'
          });
          throw renderError;
        }
      } catch (error) {
        console.error('Error in micropost index:', {
          error: error.message,
          stack: error.stack,
          path: req.path,
          query: req.query,
          user: req.user ? { id: req.user.id } : null
        });
        throw error;
      }
    });
  }

  async show(req, res) {
    return this.handleRequest(req, res, async () => {

      const micropostId = parseInt(req.params.id, 10);
      if (isNaN(micropostId)) {
        console.error('Invalid micropost ID:', req.params.id);
        return this.errorHandler.handleNotFoundError(req, res, '投稿が見つかりません');
      }

      // Get client's IP address
      const ipAddress = req.headers['x-forwarded-for']?.split(',')[0].trim() || 
                       req.socket.remoteAddress;

      try {
        // Track the view
        await this.micropostService.trackView(micropostId, ipAddress);

        // Get micropost with updated view count and check if user has liked it
        const [micropost, isLiked, likeCount, comments, likedUsers] = await Promise.all([
          this.micropostService.getMicropostWithViews(micropostId),
          req.user ? this.likeService.isLiked(req.user.id, micropostId) : false,
          this.likeService.getLikeCount(micropostId),
          this.commentService.getCommentsByMicropostId(micropostId),
          this.likeService.getLikedUsers(micropostId)
        ]);

        if (!micropost) {
          console.error('Micropost not found:', micropostId);
          return this.errorHandler.handleNotFoundError(req, res, '投稿が見つかりません');
        }



        const templateData = {
          micropost,
          isLiked,
          likeCount,
          comments,
          likedUsers,
          title: micropost.title,
          path: req.path,
          user: req.user,
          csrfToken: req.csrfToken(),
          currentPage: 1,
          totalPages: 1,
          categories: micropost.categories.map(mc => mc.category)
        };

        try {
          await res.render('pages/public/microposts/show', templateData);
        } catch (renderError) {
          console.error('Template rendering error:', {
            error: renderError.message,
            stack: renderError.stack,
            templatePath: 'pages/public/microposts/show',
            templateData: JSON.stringify(templateData, (key, value) => {
              if (key === 'comments' || key === 'categories' || key === 'likedUsers') {
                return `[Array(${value.length})]`;
              }
              return value;
            })
          });
          throw renderError;
        }
      } catch (error) {
        console.error('Error in show method:', {
          error: error.message,
          stack: error.stack,
          micropostId,
          userId: req.user?.id
        });
        throw error;
      }
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
    this.profileService = services.profile;
    this.followService = services.follow;
    this.logger = logger;

    // サービスの存在確認
    if (!this.profileService) {
      throw new Error('Profile service is not initialized in ProfileController');
    }

    if (!this.followService) {
      throw new Error('Follow service is not initialized in ProfileController');
    }
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
        profileUser = await this.services.profile.getUserProfile(req.params.id);
      } else {
        profileUser = await this.services.profile.getUserProfileByName(req.params.id);
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
        this.services.micropost.getMicropostsByUser(profileUser.id),
        this.services.profile.getFollowCounts(profileUser.id),
        req.user ? this.services.profile.isFollowing(req.user.id, profileUser.id) : false
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
  }

  async index(req, res) {
    return this.handleRequest(req, res, async () => {
      console.log('\n=== Development Tools Debug [Start] ===');
      console.log('1. Request Details:', {
        method: req.method,
        path: req.path,
        headers: JSON.stringify(req.headers, null, 2),
        cookies: JSON.stringify(req.cookies, null, 2),
        session: JSON.stringify(req.session, null, 2)
      });

      console.log('2. Response Locals [Before]:', JSON.stringify(res.locals, null, 2));

      const health = await this.services.system.getHealth();
      const dbHealth = await this.services.system.getDbHealth();

      const recentUsers = await this.services.profile.prisma.user.findMany({
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

      const recentMicroposts = await this.services.micropost.prisma.micropost.findMany({
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

      const renderOptions = {
        title: '開発支援機能',
        path: req.path,
        health,
        dbHealth,
        recentUsers,
        recentMicroposts,
        layout: 'layouts/dev'
      };

      console.log('3. Response Locals [After Title]:', JSON.stringify(res.locals, null, 2));
      console.log('4. Render Options:', JSON.stringify(renderOptions, null, 2));
      console.log('5. Template Path: pages/development-tools/index');
      console.log('=== Development Tools Debug [End] ===\n');

      res.render('pages/development-tools/index', renderOptions);
    });
  }

  async quickLogin(req, res) {
    return this.handleRequest(req, res, async () => {
      const { email } = req.params;
      const user = await this.services.profile.prisma.user.findUnique({
        where: { email }
      });

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

  async like(req, res) {
    return this.handleRequest(req, res, async () => {
      if (!req.user) {
        return this.errorHandler.handlePermissionError(req, res, 'ログインが必要です');
      }

      const micropostId = req.params.id;
      await this.services.like(req.user.id, micropostId);
      const likeCount = await this.services.getLikeCount(micropostId);

      this.sendResponse(req, res, {
        status: 200,
        success: true,
        message: 'いいねしました',
        data: { likeCount }
      });
    });
  }

  async unlike(req, res) {
    return this.handleRequest(req, res, async () => {
      if (!req.user) {
        return this.errorHandler.handlePermissionError(req, res, 'ログインが必要です');
      }

      const micropostId = req.params.id;
      await this.services.unlike(req.user.id, micropostId);
      const likeCount = await this.services.getLikeCount(micropostId);

      this.sendResponse(req, res, {
        status: 200,
        success: true,
        message: 'いいねを取り消しました',
        data: { likeCount }
      });
    });
  }

  async getLikedUsers(req, res) {
    return this.handleRequest(req, res, async () => {
      const micropostId = req.params.id;
      const likedUsers = await this.services.getLikedUsers(micropostId);
      
      this.sendResponse(req, res, {
        status: 200,
        data: { likedUsers }
      });
    });
  }

  async getUserLikes(req, res) {
    return this.handleRequest(req, res, async () => {
      if (!req.user) {
        return this.errorHandler.handlePermissionError(req, res, 'ログインが必要です');
      }

      const userId = req.params.id;
      const likes = await this.services.getUserLikes(userId);
      
      this.sendResponse(req, res, {
        status: 200,
        data: { likes }
      });
    });
  }
}

class CommentController extends BaseController {
  constructor(services, errorHandler, logger) {
    super(services, errorHandler, logger);
  }

  async create(req, res) {
    return this.handleRequest(req, res, async () => {
      const { content } = req.body;
      const micropostId = parseInt(req.params.micropostId, 10);

      if (!content?.trim()) {
        throw this.errorHandler.createValidationError('コメント内容を入力してください', {
          code: 'EMPTY_CONTENT',
          field: 'content',
          value: content,
          constraint: 'required'
        });
      }

      await this.services.comment.createComment({
        content: content.trim(),
        userId: req.user.id,
        micropostId
      });

      this.sendResponse(req, res, {
        message: 'コメントを投稿しました',
        redirectUrl: `/microposts/${micropostId}`
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
  return {
    auth: new AuthController(services.auth, errorHandler, logger),
    profile: new ProfileController(services.profile, errorHandler, logger),
    micropost: new MicropostController(services.micropost, errorHandler, logger),
    system: new SystemController(services.system, errorHandler, logger),
    developmentTools: new DevelopmentToolsController(services, errorHandler, logger),
    admin: new AdminController(services, errorHandler, logger),
    category: new CategoryController(services.category, errorHandler, logger),
    like: new LikeController(services, errorHandler, logger),
    comment: new CommentController(services, errorHandler, logger),
    notification: new NotificationController(services, errorHandler, logger)
  };
}; 