class BaseController {
  constructor(services, errorHandler, logger) {
    this.services = services;
    this.errorHandler = errorHandler;
    this.logger = logger;
  }

  async handleRequest(req, res, handler) {
    try {
      await handler();
    } catch (error) {
      if (this.errorHandler && typeof this.errorHandler.handleError === 'function') {
        this.errorHandler.handleError(error, req, res);
      } else {
        // フォールバックのエラーハンドリング
        console.error('Error:', error);
        res.status(500).json({
          success: false,
          message: 'サーバーエラーが発生しました'
        });
      }
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
      this.sendResponse(req, res, {
        message: 'ユーザー登録が完了しました',
        redirectUrl: '/'
      });
    });
  }

  async login(req, res) {
    return this.handleRequest(req, res, async () => {
      await this.services.login(req, res);
      this.sendResponse(req, res, {
        message: 'ログインしました',
        redirectUrl: '/'
      });
    });
  }

  async logout(req, res) {
    return this.handleRequest(req, res, async () => {
      try {
        await this.services.logout(req);
      } catch (error) {
        // Continue with logout even if session destruction fails
        console.error('Session destruction error:', error);
      }

      res.clearCookie('connect.sid', {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict'
      });
      
      const isApiRequest = req.xhr || req.headers.accept?.includes('application/json');
      if (isApiRequest) {
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
  constructor(services, fileUploader, errorHandler, logger) {
    super(services, errorHandler, logger);
    this.fileUploader = fileUploader;
    this.micropostService = services.micropost;
    this.likeService = services.like;
    this.commentService = services.comment;
  }

  async index(req, res) {
    return this.handleRequest(req, res, async () => {
      const [microposts, categories] = await Promise.all([
        this.micropostService.getAllMicroposts(),
        this.micropostService.prisma.category.findMany({
          orderBy: { name: 'asc' }
        })
      ]);

      // 各投稿のいいね情報を取得
      const micropostsWithLikes = await Promise.all(
        microposts.map(async (micropost) => {
          const [isLiked, likeCount] = await Promise.all([
            req.user ? this.likeService.isLiked(req.user.id, micropost.id) : false,
            this.likeService.getLikeCount(micropost.id)
          ]);
          return { ...micropost, isLiked, likeCount };
        })
      );

      res.render('pages/public/microposts/index', { 
        microposts: micropostsWithLikes,
        categories,
        title: '投稿一覧',
        path: req.path,
        user: req.user
      });
    });
  }

  async show(req, res) {
    return this.handleRequest(req, res, async () => {
      const micropostId = parseInt(req.params.id, 10);
      if (isNaN(micropostId)) {
        return this.errorHandler.handleNotFoundError(req, res, '投稿が見つかりません');
      }

      // Get client's IP address
      const ipAddress = req.headers['x-forwarded-for']?.split(',')[0].trim() || 
                       req.socket.remoteAddress;

      // Track the view
      await this.micropostService.trackView(micropostId, ipAddress);

      // Get micropost with updated view count and check if user has liked it
      const [micropost, isLiked, likeCount, comments] = await Promise.all([
        this.micropostService.getMicropostWithViews(micropostId),
        req.user ? this.likeService.isLiked(req.user.id, micropostId) : false,
        this.likeService.getLikeCount(micropostId),
        this.commentService.getCommentsByMicropostId(micropostId)
      ]);

      if (!micropost) {
        return this.errorHandler.handleNotFoundError(req, res, '投稿が見つかりません');
      }

      res.render('pages/public/microposts/show', {
        micropost,
        isLiked,
        likeCount,
        comments,
        title: micropost.title,
        path: req.path,
        user: req.user
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

      await this.micropostService.createMicropost({
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

      this.renderWithUser(req, res, 'pages/public/profile/edit', {
        title: 'プロフィール編集',
        profileUser: user
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
        avatarPath = path.basename(req.file.path);
      }

      const updatedUser = await this.services.profile.updateProfile(userId, {
        ...req.body,
        avatarPath
      });
      
      this.sendResponse(req, res, {
        message: 'プロフィールを更新しました',
        redirectUrl: `/profile/${updatedUser.name || userId}`
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
  constructor(services, errorHandler, logger) {
    super(services, errorHandler, logger);
  }

  async index(req, res) {
    return this.handleRequest(req, res, async () => {
      const metadata = await this.services.system.getInstanceMetadata();
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

      res.render('pages/dev/index', {
        title: '開発支援機能',
        path: req.path,
        metadata,
        health,
        dbHealth,
        recentUsers,
        recentMicroposts,
        layout: 'layouts/dev'
      });
    });
  }

  async quickLogin(req, res) {
    return this.handleRequest(req, res, async () => {
      const { email } = req.params;
      const user = await this.services.profile.prisma.user.findUnique({
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
  constructor(services, errorHandler, logger) {
    super(errorHandler, logger);
    this.categoryService = services.category;
  }

  async index(req, res) {
    return this.handleRequest(req, res, async () => {
      const categories = await this.categoryService.getAllCategories();
      res.render('pages/public/categories/index', {
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
      res.render('pages/public/categories/show', {
        category,
        title: `カテゴリー: ${category.name}`,
        path: req.path
      });
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

module.exports = {
  AuthController,
  ProfileController,
  MicropostController,
  SystemController,
  DevController,
  AdminController,
  CategoryController,
  LikeController,
  CommentController,
  NotificationController
}; 