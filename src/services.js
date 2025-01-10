const bcrypt = require('bcrypt');
const passport = require('passport');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// 定数定義
const CONSTANTS = {
  PATHS: {
    DEFAULT_AVATAR: process.env.DEFAULT_AVATAR_PATH,
    UPLOAD_DIR: process.env.UPLOAD_DIR_PATH,
    PUBLIC_DIR: process.env.PUBLIC_DIR_PATH
  },
  NOTIFICATION_TYPES: {
    FOLLOW: 'FOLLOW',
    LIKE: 'LIKE',
    COMMENT: 'COMMENT'
  },
  AUTH: {
    PASSWORD_MIN_LENGTH: 6,
    TOKEN_EXPIRY: 24 * 60 * 60 * 1000 // 24時間
  }
};

// 共通のユーティリティ関数
const ValidationUtils = {
  validateId(id) {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      throw new Error(`Invalid ID: ${id}`);
    }
    return numId;
  },

  validateEmail(email) {
    if (!email || !email.includes('@')) {
      throw new Error('Invalid email format');
    }
    return email;
  },

  validatePassword(password, confirmation) {
    if (!password || password.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }
    if (confirmation && password !== confirmation) {
      throw new Error('Passwords do not match');
    }
    return password;
  },

  validateUsername(name) {
    if (!name || !name.match(/^[a-zA-Z0-9]+$/)) {
      throw new Error('Username must contain only alphanumeric characters');
    }
    return name;
  }
};

// 共通のエラーハンドリングユーティリティ
const ErrorUtils = {
  handleError(error, context, logger) {
    logger.error('Error occurred', {
      context,
      error: error.message,
      stack: error.stack,
      name: error.name
    });
    throw error;
  },

  handleDatabaseError(error, operation, logger) {
    logger.error('Database error', {
      operation,
      error: error.message,
      code: error.code
    });
    throw error;
  }
};

// ベース抽象クラス - 共通機能を提供
class BaseService {
  constructor(prisma, logger) {
    if (!prisma) throw new Error('Prisma client is required');
    if (!logger) throw new Error('Logger is required');
    
    this.prisma = prisma;
    this.logger = logger;
  }

  // 共通のバリデーションメソッド
  validateId(id) {
    return ValidationUtils.validateId(id);
  }

  // エラーハンドリング
  handleError(error, context = {}) {
    ErrorUtils.handleError(error, context, this.logger);
  }

  handleDatabaseError(error, operation) {
    ErrorUtils.handleDatabaseError(error, operation, this.logger);
  }

  // トランザクション実行の共通メソッド
  async executeTransaction(callback) {
    try {
      return await this.prisma.$transaction(async (prisma) => {
        return callback(prisma);
      });
    } catch (error) {
      this.handleDatabaseError(error, 'Transaction execution');
    }
  }

  // 共通のユーザー検索メソッド
  async findUserById(userId, includeProfile = true, includeRoles = true) {
    try {
      return await this.prisma.user.findUnique({
        where: { id: this.validateId(userId) },
        include: {
          profile: includeProfile,
          userRoles: includeRoles ? {
            include: { role: true }
          } : undefined,
          _count: {
            select: { microposts: true }
          }
        }
      });
    } catch (error) {
      this.handleDatabaseError(error, 'Find user by ID');
    }
  }

  // 通知作成の共通メソッド
  async createNotification(type, recipientId, actorId, data = {}) {
    if (!Object.values(CONSTANTS.NOTIFICATION_TYPES).includes(type)) {
      throw new Error('Invalid notification type');
    }

    try {
      return await this.executeTransaction(async (prisma) => {
        const notification = await prisma.notification.create({
          data: {
            type,
            recipientId: this.validateId(recipientId),
            actorId: this.validateId(actorId),
            micropostId: data.micropostId ? this.validateId(data.micropostId) : null,
            commentId: data.commentId ? this.validateId(data.commentId) : null,
            read: false
          },
          include: {
            actor: {
              include: {
                profile: true
              }
            },
            micropost: true,
            comment: true
          }
        });

        // プロフィルが存在しない場合は作成
        if (!notification.actor.profile) {
          await prisma.userProfile.create({
            data: {
              userId: actorId,
              avatarPath: CONSTANTS.PATHS.DEFAULT_AVATAR
            }
          });
        }

        return notification;
      });
    } catch (error) {
      this.handleDatabaseError(error, 'Create notification');
    }
  }

  // ファイルパス正規化
  normalizeAvatarPath(avatarPath) {
    if (!avatarPath) return CONSTANTS.PATHS.DEFAULT_AVATAR;
    if (avatarPath.startsWith('/uploads/')) return avatarPath;
    return `/uploads/${avatarPath.replace(/^\//, '')}`;
  }

  // ログ出力の共通メソッド
  logInfo(message, data = {}) {
    this.logger.info(message, data);
  }

  logError(message, error, data = {}) {
    this.logger.error(message, {
      ...data,
      error: error.message,
      stack: error.stack,
      name: error.name
    });
  }

  logDebug(message, data = {}) {
    this.logger.debug(message, data);
  }

  logWarn(message, data = {}) {
    this.logger.warn(message, data);
  }
}

// 認証エラークラスの追加
class AuthError extends Error {
  constructor(code, message) {
    super(message || AuthError.getDefaultMessage(code));
    this.code = code;
  }

  static getDefaultMessage(code) {
    const messages = {
      INVALID_CREDENTIALS: 'メールアドレスまたはパスワードが正しくありません',
      USER_NOT_FOUND: 'ユーザーが見つかりません',
      INVALID_CURRENT_PASSWORD: '現在のパスワードが正しくありません',
      INVALID_TOKEN: '無効なトークンです',
      TOKEN_EXPIRED: 'トークンの有効期限が切れています'
    };
    return messages[code] || '認証エラーが発生しました';
  }
}

// 認証関連サービス
class AuthService extends BaseService {
  constructor(prisma, logger) {
    super(prisma, logger);
    this.csrfTokens = new Map();
    this.cleanupInterval = null;
  }

  // ユーザー登録
  async signup({ email, password, name, terms, roles = ['user'] }) {
    try {
      // 入力値の検証
      ValidationUtils.validateEmail(email);
      ValidationUtils.validatePassword(password);
      ValidationUtils.validateUsername(name);

      if (terms !== 'on') {
        throw new Error('利用規約への同意が必要です');
      }

      // メールアドレスの重複チェック
      const existingUser = await this._findUserByEmail(email);
      if (existingUser) {
        throw new Error('このメールアドレスは既に登録されています');
      }

      // パスワードのハッシュ化
      const hashedPassword = await bcrypt.hash(password, 10);

      // トランザクションでユーザー作成
      return await this.executeTransaction(async (prisma) => {
        // 指定されたロールの取得
        const availableRoles = await prisma.role.findMany({
          where: {
            name: { in: roles }
          }
        });

        if (availableRoles.length === 0) {
          throw new Error('指定されたロールが見つかりません');
        }

        // ユーザーの作成
        const user = await prisma.user.create({
          data: {
            email,
            password: hashedPassword,
            name,
            userRoles: {
              create: availableRoles.map(role => ({
                role: {
                  connect: {
                    id: role.id
                  }
                }
              }))
            },
            profile: {
              create: {
                avatarPath: '/uploads/default-avatar.png'
              }
            }
          },
          include: {
            userRoles: {
              include: {
                role: true
              }
            },
            profile: true
          }
        });

        this.logInfo('User registered successfully', { userId: user.id, email });
        return user;
      });
    } catch (error) {
      this.logError('User registration failed', error, { email });
      throw error;
    }
  }

  // 認証の核となるメソッド
  async authenticate(email, password) {
    try {
      console.log('Authentication attempt:', { email });

      const user = await this._findUserByEmail(email);
      console.log('User found:', {
        id: user?.id,
        email: user?.email,
        hashedPassword: user?.password ? 'exists' : 'missing'
      });

      if (!user) {
        console.log('Authentication failed: User not found');
        throw new Error('メールアドレスまたはパスワードが正しくありません');
      }

      const isValid = await this._validatePassword(password, user.password);
      console.log('Password validation:', { isValid });

      if (!isValid) {
        console.log('Authentication failed: Invalid password');
        throw new Error('メールアドレスまたはパスワードが正しくありません');
      }

      // ユーザーロールの取得
      const userWithRoles = await this.prisma.user.findUnique({
        where: { id: user.id },
        include: {
          userRoles: {
            include: { role: true }
          }
        }
      });

      console.log('Authentication successful:', {
        id: userWithRoles.id,
        email: userWithRoles.email,
        roles: userWithRoles.userRoles.map(ur => ur.role.name)
      });

      return userWithRoles;
    } catch (error) {
      console.error('Authentication error in service:', {
        error: error.message,
        stack: error.stack,
        type: error.constructor.name
      });
      throw error;
    }
  }

  // メールアドレスでユーザーを検索
  async _findUserByEmail(email) {
    try {
      console.log('Finding user by email:', { email });
      const user = await this.prisma.user.findUnique({
        where: { email },
        include: {
          userRoles: {
            include: { role: true }
          }
        }
      });
      console.log('User search result:', {
        found: !!user,
        id: user?.id,
        email: user?.email,
        roles: user?.userRoles?.map(ur => ur.role.name)
      });
      return user;
    } catch (error) {
      console.error('Error finding user:', {
        error: error.message,
        email
      });
      throw error;
    }
  }

  // パスワードの検証
  async _validatePassword(inputPassword, hashedPassword) {
    try {
      console.log('Validating password');
      const isValid = await bcrypt.compare(inputPassword, hashedPassword);
      console.log('Password validation result:', { isValid });
      return isValid;
    } catch (error) {
      console.error('Password validation error:', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  // パスワード変更
  async changePassword(userId, currentPassword, newPassword) {
    try {
      const user = await this.findUserById(userId);
      if (!user) {
        throw new AuthError('USER_NOT_FOUND');
      }

      const isValid = await this._validatePassword(currentPassword, user.password);
      if (!isValid) {
        throw new AuthError('INVALID_CURRENT_PASSWORD');
      }

      const hashedPassword = await this._hashPassword(newPassword);
      await this._updatePassword(userId, hashedPassword);
    } catch (error) {
      this.handleError(error, { context: 'Password change' });
    }
  }

  // CSRFトークン管理
  generateCsrfToken(sessionId) {
    const token = require('crypto').randomBytes(32).toString('hex');
    this.csrfTokens.set(sessionId, {
      token,
      createdAt: new Date()
    });
    return token;
  }

  validateCsrfToken(sessionId, token) {
    const storedData = this.csrfTokens.get(sessionId);
    if (!storedData) return false;

    const tokenAge = Date.now() - storedData.createdAt;
    if (tokenAge > CONSTANTS.AUTH.TOKEN_EXPIRY) {
      this.csrfTokens.delete(sessionId);
      return false;
    }

    return storedData.token === token;
  }

  async _hashPassword(password) {
    return bcrypt.hash(password, 10);
  }

  async _validateSignupData(email, password, name) {
    ValidationUtils.validateEmail(email);
    ValidationUtils.validatePassword(password);
    ValidationUtils.validateUsername(name);

    const existingUser = await this._findUserByEmail(email);
    if (existingUser) {
      throw new AuthError('USER_EXISTS', 'このメールアドレスは既に登録されています');
    }
  }

  async _createUser(prisma, userData) {
    return prisma.user.create({
      data: userData,
      include: {
        userRoles: {
          include: { role: true }
        }
      }
    });
  }

  async _assignDefaultRole(prisma, userId) {
    const userRole = await prisma.role.findUnique({
      where: { name: 'user' }
    });
    
    if (!userRole) {
      throw new Error('デフォルトのユーザーロールが見つかりません');
    }

    return prisma.userRole.create({
      data: {
        userId,
        roleId: userRole.id
      }
    });
  }

  async _updatePassword(userId, hashedPassword) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword }
    });
  }
}

// パスポート認証サービス
class PassportService extends AuthService {
  constructor(prisma, logger) {
    super(prisma, logger);
    this.passport = require('passport');
    this.LocalStrategy = require('passport-local').Strategy;
    this.initialized = false;
  }

  // 後方互換性のために残す
  configurePassport() {
    return this.initialize();
  }

  // Passport設定の初期化
  initialize() {
    if (this.initialized) {
      this.logWarn('Passport is already configured');
      return this.passport;
    }

    try {
      this._configureLocalStrategy();
      this._configureSerializationMethods();
      this.initialized = true;
      this.logInfo('Passport configuration completed');
      return this.passport.initialize();
    } catch (error) {
      this.handleError(error, { context: 'Initialize passport' });
    }
  }

  // セッション管理の初期化
  session() {
    if (!this.initialized) {
      this.initialize();
    }
    return this.passport.session();
  }

  // 認証ミドルウェアの生成
  createAuthMiddleware() {
    return this.passport.authenticate('local', {
      failureRedirect: '/login',
      failureFlash: true
    });
  }

  // プライベートメソッド
  _configureLocalStrategy() {
    this.passport.use(new this.LocalStrategy(
      {
        usernameField: 'email',
        passwordField: 'password'
      },
      async (email, password, done) => {
        try {
          const user = await this._verifyUser(email, password);
          return done(null, user);
        } catch (error) {
          this.logError('Authentication failed', error);
          return done(null, false, { message: error.message });
        }
      }
    ));
  }

  _configureSerializationMethods() {
    this.passport.serializeUser((user, done) => {
      done(null, user.id);
    });

    this.passport.deserializeUser(async (id, done) => {
      try {
        const user = await this.findUserById(id, false);
        done(null, user);
      } catch (error) {
        this.logError('User deserialization failed', error);
        done(error);
      }
    });
  }

  async _verifyUser(email, password) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        userRoles: {
          include: { role: true }
        }
      }
    });

    if (!user) {
      throw new AuthError('INVALID_CREDENTIALS');
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      throw new AuthError('INVALID_CREDENTIALS');
    }

    return user;
  }
}

// プロフィール関連サービス
class ProfileService extends BaseService {
  constructor(prisma, logger) {
    super(prisma, logger);
    this.followService = new FollowService(prisma, logger);
  }

  // プロフィール取得メソッド
  async getUserProfile(userId) {
    try {
      return await this.findUserById(userId);
    } catch (error) {
      this.handleError(error, { context: 'Get user profile', userId });
    }
  }

  async getUserProfileByName(username) {
    try {
      this.logger.debug('Getting user profile by name:', { username });
      
      const user = await this.prisma.user.findFirst({
        where: { name: username },
        include: {
          profile: true,
          userRoles: {
            include: {
              role: true
            }
          }
        }
      });

      this.logger.debug('User profile found:', { 
        userId: user?.id,
        username: user?.name 
      });

      return user;
    } catch (error) {
      this.handleError(error, { context: 'Get user profile by name', username });
    }
  }

  async getAllUsers() {
    try {
      return await this.prisma.user.findMany({
        include: {
          profile: true,
          userRoles: {
            include: { role: true }
          },
          _count: {
            select: { microposts: true }
          }
        },
        orderBy: { id: 'desc' }
      });
    } catch (error) {
      this.handleError(error, { context: 'Get all users' });
    }
  }

  // プロフィール更新メソッド
  async updateProfile(userId, profileData) {
    try {
      const parsedId = this.validateId(userId);
      if (profileData.name) {
        ValidationUtils.validateUsername(profileData.name);
      }

      return await this.executeTransaction(async (prisma) => {
        // ユーザー情報の更新
        await prisma.user.update({
          where: { id: parsedId },
          data: { 
            name: profileData.name || undefined
          }
        });

        // プロフィール情報の更新
        await prisma.userProfile.upsert({
          where: { userId: parsedId },
          create: {
            userId: parsedId,
            bio: profileData.bio || '',
            location: profileData.location || '',
            website: profileData.website || '',
            birthDate: profileData.birthDate ? new Date(profileData.birthDate) : null,
            avatarPath: this.normalizeAvatarPath(profileData.avatarPath)
          },
          update: {
            bio: profileData.bio || '',
            location: profileData.location || '',
            website: profileData.website || '',
            birthDate: profileData.birthDate ? new Date(profileData.birthDate) : null,
            ...(profileData.avatarPath && { avatarPath: this.normalizeAvatarPath(profileData.avatarPath) })
          }
        });

        return this.findUserById(parsedId);
      });
    } catch (error) {
      this.handleError(error, { context: 'Update profile', userId });
    }
  }

  // ロール管理メソッド
  async updateUserRoles(userId, roleNames) {
    try {
      const parsedId = this.validateId(userId);
      
      return await this.executeTransaction(async (prisma) => {
        const roles = await prisma.role.findMany({
          where: {
            name: { in: roleNames }
          }
        });

        const roleMap = new Map(roles.map(role => [role.name, role.id]));
        const selectedRoleIds = roleNames
          .filter(name => roleMap.has(name))
          .map(name => roleMap.get(name));

        // 既存のロールを削除
        await prisma.userRole.deleteMany({
          where: { userId: parsedId }
        });

        // 新しいロールを作成
        await prisma.userRole.createMany({
          data: selectedRoleIds.map(roleId => ({
            userId: parsedId,
            roleId
          }))
        });

        return this.findUserById(parsedId);
      });
    } catch (error) {
      this.handleError(error, { context: 'Update user roles', userId });
    }
  }

  // フォロー関連メソッド
  async getFollowCounts(userId) {
    try {
      const [followingCount, followersCount] = await Promise.all([
        this.prisma.follow.count({
          where: { followerId: userId }
        }),
        this.prisma.follow.count({
          where: { followingId: userId }
        })
      ]);

      return { followingCount, followersCount };
    } catch (error) {
      this.handleError(error, { context: 'Get follow counts', userId });
    }
  }

  async isFollowing(followerId, followingId) {
    try {
      const follow = await this.prisma.follow.findFirst({
        where: {
          followerId,
          followingId
        }
      });
      return !!follow;
    } catch (error) {
      this.handleError(error, { context: 'Check following status', followerId, followingId });
    }
  }

  async getFollowing(userId) {
    try {
      return await this.followService.getFollowing(userId);
    } catch (error) {
      this.handleError(error, { context: 'Get following users', userId });
    }
  }

  async getFollowers(userId) {
    try {
      return await this.followService.getFollowers(userId);
    } catch (error) {
      this.handleError(error, { context: 'Get followers', userId });
    }
  }

  // ユーティリティメソッド
  async findUserByIdentifier(identifier) {
    try {
      let user = null;

      if (identifier.match(/^[0-9]+$/)) {
        user = await this.getUserProfile(parseInt(identifier, 10));
      } else if (identifier.includes('@')) {
        user = await this.prisma.user.findUnique({
          where: { email: identifier },
          include: {
            profile: true,
            userRoles: {
              include: { role: true }
            }
          }
        });
      } else {
        user = await this.getUserProfileByName(identifier);
      }

      return user;
    } catch (error) {
      this.handleError(error, { context: 'Find user by identifier', identifier });
    }
  }

  async createProfile(userId, profileData) {
    try {
      return await this.prisma.userProfile.create({
        data: {
          userId,
          avatarPath: profileData.avatarPath || CONSTANTS.PATHS.DEFAULT_AVATAR,
          bio: profileData.bio || '',
          location: profileData.location || '',
          website: profileData.website || '',
          birthDate: profileData.birthDate ? new Date(profileData.birthDate) : null
        }
      });
    } catch (error) {
      this.handleError(error, { context: 'Create profile', userId });
    }
  }
}

// 投稿関連サービス
class MicropostService extends BaseService {
  // 投稿取得メソッド
  async getAllMicroposts() {
    try {
      return await this.prisma.micropost.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              profile: true,
              userRoles: {
                include: { role: true }
              }
            }
          },
          categories: {
            include: { category: true }
          },
          _count: {
            select: { 
              views: true,
              likes: true,
              comments: true
            }
          }
        }
      });
    } catch (error) {
      this.handleError(error, { context: 'Get all microposts' });
    }
  }

  async getMicropostsByUser(userId) {
    try {
      const validUserId = this.validateId(userId);
      return await this.prisma.micropost.findMany({
        where: { userId: validUserId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              userRoles: {
                include: { role: true }
              }
            }
          }
        }
      });
    } catch (error) {
      this.handleError(error, { context: 'Get microposts by user', userId });
    }
  }

  async getMicropostWithViews(micropostId) {
    try {
      const validMicropostId = this.validateId(micropostId);
      const micropost = await this.prisma.micropost.findUnique({
        where: { id: validMicropostId },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              profile: true,
              userRoles: {
                include: {
                  role: true
                }
              }
            }
          },
          categories: {
            include: {
              category: true
            }
          },
          comments: {
            include: {
              user: {
                include: {
                  profile: true
                }
              }
            },
            orderBy: {
              createdAt: 'desc'
            }
          },
          _count: {
            select: {
              views: true,
              likes: true,
              comments: true
            }
          }
        }
      });

      if (!micropost) {
        this.logWarn('Micropost not found', { micropostId });
        return null;
      }

      return micropost;
    } catch (error) {
      this.handleError(error, { context: 'Get micropost with views', micropostId });
    }
  }

  // 投稿作成メソッド
  async createMicropost({ title, imageUrl, userId, categories = [] }) {
    try {
      const validUserId = this.validateId(userId);
      const validCategories = categories.map(id => this.validateId(id));

      return await this.executeTransaction(async (prisma) => {
        return prisma.micropost.create({
          data: {
            title,
            imageUrl,
            userId: validUserId,
            categories: {
              create: validCategories.map(categoryId => ({
                categoryId
              }))
            }
          },
          include: {
            user: {
              select: {
                id: true,
                email: true
              }
            },
            categories: {
              include: { category: true }
            }
          }
        });
      });
    } catch (error) {
      this.handleError(error, { context: 'Create micropost', userId });
    }
  }

  // ビュー関連メソッド
  async trackView(micropostId, ipAddress) {
    try {
      const validMicropostId = this.validateId(micropostId);

      // 最後の24時間以内の同じIPからのビューを確認
      const recentView = await this.prisma.micropostView.findFirst({
        where: {
          micropostId: validMicropostId,
          ipAddress: ipAddress,
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // 24時間前
          }
        }
      });

      // 同じIPからの最近のビューがない場合のみカウント
      if (!recentView) {
        await this.prisma.micropostView.create({
          data: {
            micropostId: validMicropostId,
            ipAddress: ipAddress
          }
        });

        // ビュー数を更新
        await this.prisma.micropost.update({
          where: { id: validMicropostId },
          data: {
            viewCount: {
              increment: 1
            }
          }
        });
      }
    } catch (error) {
      this.handleError(error, { context: 'Track view', micropostId, ipAddress });
    }
  }

  async getViewCount(micropostId) {
    try {
      return await this.prisma.micropostView.count({
        where: { micropostId: this.validateId(micropostId) }
      });
    } catch (error) {
      this.handleError(error, { context: 'Get view count', micropostId });
    }
  }
}

// カテゴリ関連サービス
class CategoryService extends BaseService {
  // カテゴリ取得メソッド
  async getAllCategories() {
    try {
      this.logInfo('Starting getAllCategories');
      this.logDebug('Executing category query with includes');

      const categories = await this.prisma.category.findMany({
        include: {
          microposts: {
            include: {
              micropost: {
                include: {
                  user: {
                    select: {
                      id: true,
                      name: true,
                      email: true
                    }
                  },
                  _count: {
                    select: {
                      likes: true,
                      comments: true,
                      views: true
                    }
                  }
                }
              }
            }
          },
          _count: {
            select: {
              microposts: true
            }
          }
        },
        orderBy: {
          name: 'asc'
        }
      });

      const hasRecords = categories.length > 0;
      this.logInfo('Categories query completed', {
        hasRecords,
        count: categories.length,
        recordIds: hasRecords ? categories.map(c => c.id) : [],
        recordNames: hasRecords ? categories.map(c => c.name) : []
      });

      if (!hasRecords) {
        this.logWarn('No categories found in the database');
        return [];
      }

      this.logInfo('Categories retrieved successfully', {
        count: categories.length,
        categoriesWithPosts: categories.map(c => ({
          id: c.id,
          name: c.name,
          postsCount: c._count.microposts
        }))
      });

      return categories;
    } catch (error) {
      this.handleError(error, {
        context: 'Get all categories',
        message: 'Failed to retrieve categories'
      });
    }
  }

  async getCategoryById(id) {
    try {
      const validatedId = this.validateId(id);

      const category = await this.prisma.category.findUnique({
        where: { 
          id: validatedId
        },
        include: {
          microposts: {
            include: {
              micropost: {
                include: {
                  user: {
                    include: {
                      profile: true
                    }
                  }
                }
              }
            }
          }
        }
      });

      if (!category) {
        this.logWarn('Category not found', { categoryId: validatedId });
        return null;
      }

      return category;
    } catch (error) {
      this.handleError(error, {
        context: 'Get category by ID',
        categoryId: id
      });
    }
  }

  // カテゴリ作成メソッド
  async createCategory(name, description = '') {
    try {
      return await this.prisma.category.create({
        data: {
          name,
          description
        }
      });
    } catch (error) {
      this.handleError(error, {
        context: 'Create category',
        name
      });
    }
  }

  // カテゴリ更新メソッド
  async updateCategory(id, data) {
    try {
      const validatedId = this.validateId(id);
      return await this.prisma.category.update({
        where: { id: validatedId },
        data
      });
    } catch (error) {
      this.handleError(error, {
        context: 'Update category',
        categoryId: id
      });
    }
  }

  // カテゴリ削除メソッド
  async deleteCategory(id) {
    try {
      const validatedId = this.validateId(id);
      return await this.prisma.category.delete({
        where: { id: validatedId }
      });
    } catch (error) {
      this.handleError(error, {
        context: 'Delete category',
        categoryId: id
      });
    }
  }
}

// システム関連サービス
class SystemService extends BaseService {
  // ヘルスチェックメソッド
  async getHealth() {
    try {
      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
      };
    } catch (error) {
      this.handleError(error, { context: 'Get system health' });
    }
  }

  async getDbHealth() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'healthy',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  // システム統計メソッド
  async getStats() {
    try {
      return await this.executeTransaction(async (prisma) => {
        const [
          totalUsers,
          totalPosts,
          totalCategories,
          totalComments
        ] = await Promise.all([
          prisma.user.count(),
          prisma.micropost.count(),
          prisma.category.count(),
          prisma.comment.count()
        ]);

        return {
          totalUsers,
          totalPosts,
          totalCategories,
          totalComments,
          timestamp: new Date()
        };
      });
    } catch (error) {
      this.handleError(error, { context: 'Get system stats' });
    }
  }

  // システム設定メソッド
  async getSystemSettings() {
    try {
      return {
        environment: process.env.NODE_ENV || 'development',
        uploadPath: CONSTANTS.PATHS.UPLOAD_DIR,
        maxUploadSize: process.env.MAX_UPLOAD_SIZE || '5MB',
        allowedFileTypes: ['image/jpeg', 'image/png', 'image/gif'],
        version: process.env.APP_VERSION || '1.0.0'
      };
    } catch (error) {
      this.handleError(error, { context: 'Get system settings' });
    }
  }

  // メンテナンスモード管理
  async setMaintenanceMode(enabled) {
    try {
      // メンテナンスモードの状態を保存
      await this.prisma.systemSetting.upsert({
        where: { key: 'maintenance_mode' },
        create: {
          key: 'maintenance_mode',
          value: String(enabled),
          updatedAt: new Date()
        },
        update: {
          value: String(enabled),
          updatedAt: new Date()
        }
      });

      return { maintenanceMode: enabled };
    } catch (error) {
      this.handleError(error, { context: 'Set maintenance mode' });
    }
  }

  async getMaintenanceMode() {
    try {
      const setting = await this.prisma.systemSetting.findUnique({
        where: { key: 'maintenance_mode' }
      });
      return {
        maintenanceMode: setting ? setting.value === 'true' : false
      };
    } catch (error) {
      this.handleError(error, { context: 'Get maintenance mode' });
    }
  }
}

// いいね関連サービス
class LikeService extends BaseService {
  // いいね操作メソッド
  async like(userId, micropostId) {
    try {
      const validUserId = this.validateId(userId);
      const validMicropostId = this.validateId(micropostId);

      return await this.executeTransaction(async (prisma) => {
        // いいねの作成
        await prisma.like.createMany({
          data: {
            userId: validUserId,
            micropostId: validMicropostId
          },
          skipDuplicates: true
        });

        // 投稿の作成者を取得
        const micropost = await prisma.micropost.findUnique({
          where: { id: validMicropostId },
          select: { userId: true }
        });

        // 自分の投稿以外にいいねした場合のみ通知を作成
        if (micropost && micropost.userId !== validUserId) {
          await this.createNotification(
            CONSTANTS.NOTIFICATION_TYPES.LIKE,
            micropost.userId,
            validUserId,
            { micropostId: validMicropostId }
          );
        }

        return prisma.like.findUnique({
          where: {
            userId_micropostId: {
              userId: validUserId,
              micropostId: validMicropostId
            }
          }
        });
      });
    } catch (error) {
      this.handleError(error, {
        context: 'Like micropost',
        userId,
        micropostId
      });
    }
  }

  async unlike(userId, micropostId) {
    try {
      const validUserId = this.validateId(userId);
      const validMicropostId = this.validateId(micropostId);

      const like = await this.prisma.like.findUnique({
        where: {
          userId_micropostId: {
            userId: validUserId,
            micropostId: validMicropostId
          }
        }
      });

      if (!like) {
        return null;
      }

      return await this.prisma.like.delete({
        where: {
          userId_micropostId: {
            userId: validUserId,
            micropostId: validMicropostId
          }
        }
      });
    } catch (error) {
      this.handleError(error, {
        context: 'Unlike micropost',
        userId,
        micropostId
      });
    }
  }

  // いいね状態確認メソッド
  async isLiked(userId, micropostId) {
    try {
      const validUserId = this.validateId(userId);
      const validMicropostId = this.validateId(micropostId);

      const like = await this.prisma.like.findUnique({
        where: {
          userId_micropostId: {
            userId: validUserId,
            micropostId: validMicropostId
          }
        }
      });
      return !!like;
    } catch (error) {
      this.handleError(error, {
        context: 'Check like status',
        userId,
        micropostId
      });
    }
  }

  // いいね数取得メソッド
  async getLikeCount(micropostId) {
    try {
      return await this.prisma.like.count({
        where: { micropostId: this.validateId(micropostId) }
      });
    } catch (error) {
      this.handleError(error, {
        context: 'Get like count',
        micropostId
      });
    }
  }

  // いいねしたユーザー取得メソッド
  async getLikedUsers(micropostId) {
    try {
      return await this.prisma.like.findMany({
        where: { micropostId },
        include: {
          user: {
            include: {
              profile: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      });
    } catch (error) {
      this.handleError(error, {
        context: 'Get liked users',
        micropostId
      });
    }
  }

  // ユーザーのいいね一覧取得メソッド
  async getUserLikes(userId) {
    try {
      return await this.prisma.like.findMany({
        where: { userId: this.validateId(userId) },
        include: {
          micropost: {
            include: {
              user: true,
              _count: {
                select: { likes: true }
              }
            }
          }
        }
      });
    } catch (error) {
      this.handleError(error, {
        context: 'Get user likes',
        userId
      });
    }
  }
}

// コメント関連サービス
class CommentService extends BaseService {
  // コメント作成メソッド
  async createComment({ content, userId, micropostId }) {
    try {
      const validUserId = this.validateId(userId);
      const validMicropostId = this.validateId(micropostId);

      return await this.executeTransaction(async (prisma) => {
        // コメントの作成
        const comment = await prisma.comment.create({
          data: {
            content,
            userId: validUserId,
            micropostId: validMicropostId
          },
          include: {
            user: true,
            micropost: {
              select: {
                userId: true
              }
            }
          }
        });

        // 自分の投稿以外にコメントした場合のみ通知を作成
        if (comment.micropost.userId !== validUserId) {
          await this.createNotification(
            CONSTANTS.NOTIFICATION_TYPES.COMMENT,
            comment.micropost.userId,
            validUserId,
            {
              micropostId: validMicropostId,
              commentId: comment.id
            }
          );
        }

        return comment;
      });
    } catch (error) {
      this.handleError(error, {
        context: 'Create comment',
        userId,
        micropostId
      });
    }
  }

  // コメント取得メソッド
  async getCommentsByMicropostId(micropostId) {
    try {
      return await this.prisma.comment.findMany({
        where: { micropostId: this.validateId(micropostId) },
        include: {
          user: {
            include: {
              profile: true,
              userRoles: {
                include: {
                  role: true
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });
    } catch (error) {
      this.handleError(error, {
        context: 'Get comments by micropost',
        micropostId
      });
    }
  }

  // コメント更新メソッド
  async updateComment(commentId, content) {
    try {
      const validCommentId = this.validateId(commentId);
      return await this.prisma.comment.update({
        where: { id: validCommentId },
        data: { content },
        include: {
          user: {
            include: {
              profile: true
            }
          }
        }
      });
    } catch (error) {
      this.handleError(error, {
        context: 'Update comment',
        commentId
      });
    }
  }

  // コメント削除メソッド
  async deleteComment(commentId, userId) {
    try {
      const validCommentId = this.validateId(commentId);
      const validUserId = this.validateId(userId);

      const comment = await this.prisma.comment.findUnique({
        where: { id: validCommentId },
        include: {
          micropost: {
            select: {
              userId: true
            }
          }
        }
      });

      if (!comment) {
        throw new Error('Comment not found');
      }

      // コメント作成者または投稿作成者のみ削除可能
      if (comment.userId !== validUserId && comment.micropost.userId !== validUserId) {
        throw new Error('Unauthorized to delete this comment');
      }

      return await this.prisma.comment.delete({
        where: { id: validCommentId }
      });
    } catch (error) {
      this.handleError(error, {
        context: 'Delete comment',
        commentId,
        userId
      });
    }
  }

  // コメント数取得メソッド
  async getCommentCount(micropostId) {
    try {
      return await this.prisma.comment.count({
        where: { micropostId: this.validateId(micropostId) }
      });
    } catch (error) {
      this.handleError(error, {
        context: 'Get comment count',
        micropostId
      });
    }
  }

  // ユーザーのコメント一覧取得メソッド
  async getUserComments(userId) {
    try {
      return await this.prisma.comment.findMany({
        where: { userId: this.validateId(userId) },
        include: {
          micropost: {
            include: {
              user: {
                include: {
                  profile: true
                }
              }
            }
          },
          user: {
            include: {
              profile: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });
    } catch (error) {
      this.handleError(error, {
        context: 'Get user comments',
        userId
      });
    }
  }
}

// 通知関連サービス
class NotificationService extends BaseService {
  // 通知取得メソッド
  async getNotifications(userId) {
    try {
      const notifications = await this.prisma.notification.findMany({
        where: {
          recipientId: this.validateId(userId)
        },
        include: {
          actor: {
            include: {
              profile: true
            }
          },
          micropost: true,
          comment: true
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      // プロフィルが存在しない通知アクターのプロフィルを作成
      const updatedNotifications = await Promise.all(
        notifications.map(async (notification) => {
          if (!notification.actor.profile) {
            await this.prisma.userProfile.create({
              data: {
                userId: notification.actorId,
                avatarPath: CONSTANTS.PATHS.DEFAULT_AVATAR
              }
            });

            // プロフィル作成後の通知を再取得
            return await this.prisma.notification.findUnique({
              where: { id: notification.id },
              include: {
                actor: {
                  include: {
                    profile: true
                  }
                },
                micropost: true,
                comment: true
              }
            });
          }
          return notification;
        })
      );

      return updatedNotifications;
    } catch (error) {
      this.handleError(error, {
        context: 'Get notifications',
        userId
      });
    }
  }

  // 通知既読メソッド
  async markAsRead(notificationId, userId) {
    try {
      const validNotificationId = this.validateId(notificationId);
      const validUserId = this.validateId(userId);

      return await this.prisma.notification.update({
        where: {
          id: validNotificationId,
          recipientId: validUserId
        },
        data: {
          read: true
        }
      });
    } catch (error) {
      this.handleError(error, {
        context: 'Mark notification as read',
        notificationId,
        userId
      });
    }
  }

  // 未読通知数取得メソッド
  async getUnreadCount(userId) {
    try {
      return await this.prisma.notification.count({
        where: {
          recipientId: this.validateId(userId),
          read: false
        }
      });
    } catch (error) {
      this.handleError(error, {
        context: 'Get unread notification count',
        userId
      });
    }
  }

  // 全通知既読メソッド
  async markAllAsRead(userId) {
    try {
      const validUserId = this.validateId(userId);
      return await this.prisma.notification.updateMany({
        where: {
          recipientId: validUserId,
          read: false
        },
        data: {
          read: true
        }
      });
    } catch (error) {
      this.handleError(error, {
        context: 'Mark all notifications as read',
        userId
      });
    }
  }

  // 通知削除メソッド
  async deleteNotification(notificationId, userId) {
    try {
      const validNotificationId = this.validateId(notificationId);
      const validUserId = this.validateId(userId);

      return await this.prisma.notification.delete({
        where: {
          id: validNotificationId,
          recipientId: validUserId
        }
      });
    } catch (error) {
      this.handleError(error, {
        context: 'Delete notification',
        notificationId,
        userId
      });
    }
  }

  // 古い通知のクリーンアップ
  async cleanupOldNotifications(days = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      return await this.prisma.notification.deleteMany({
        where: {
          createdAt: {
            lt: cutoffDate
          },
          read: true
        }
      });
    } catch (error) {
      this.handleError(error, {
        context: 'Cleanup old notifications',
        days
      });
    }
  }
}

// モォロー関連サービス
class FollowService extends BaseService {
  // フォロー状態確認メソッド
  async isFollowing(followerId, followingId) {
    try {
      const validFollowerId = this.validateId(followerId);
      const validFollowingId = this.validateId(followingId);

      const follow = await this.prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: validFollowerId,
            followingId: validFollowingId
          }
        }
      });
      return !!follow;
    } catch (error) {
      this.handleError(error, {
        context: 'Check following status',
        followerId,
        followingId
      });
    }
  }

  // フォロー作成メソッド
  async follow(followerId, followingId) {
    try {
      const validFollowerId = this.validateId(followerId);
      const validFollowingId = this.validateId(followingId);

      return await this.executeTransaction(async (prisma) => {
        const follow = await prisma.follow.create({
          data: {
            followerId: validFollowerId,
            followingId: validFollowingId
          }
        });

        // フォロー通知の作成
        await this.createNotification(
          CONSTANTS.NOTIFICATION_TYPES.FOLLOW,
          validFollowingId,
          validFollowerId
        );

        return follow;
      });
    } catch (error) {
      this.handleError(error, {
        context: 'Follow user',
        followerId,
        followingId
      });
    }
  }

  // フォロー解除メソッド
  async unfollow(followerId, followingId) {
    try {
      const validFollowerId = this.validateId(followerId);
      const validFollowingId = this.validateId(followingId);

      return await this.prisma.follow.delete({
        where: {
          followerId_followingId: {
            followerId: validFollowerId,
            followingId: validFollowingId
          }
        }
      });
    } catch (error) {
      this.handleError(error, {
        context: 'Unfollow user',
        followerId,
        followingId
      });
    }
  }

  // フォロー数取得メソッド
  async getFollowCounts(userId) {
    try {
      const validUserId = this.validateId(userId);
      const [followingCount, followersCount] = await Promise.all([
        this.prisma.follow.count({
          where: { followerId: validUserId }
        }),
        this.prisma.follow.count({
          where: { followingId: validUserId }
        })
      ]);

      return { followingCount, followersCount };
    } catch (error) {
      this.handleError(error, {
        context: 'Get follow counts',
        userId
      });
    }
  }

  // フォロー中のユーザー取得メソッド
  async getFollowing(userId) {
    try {
      return await this.prisma.follow.findMany({
        where: { followerId: this.validateId(userId) },
        include: {
          following: {
            include: {
              profile: true,
              userRoles: {
                include: { role: true }
              }
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      });
    } catch (error) {
      this.handleError(error, {
        context: 'Get following users',
        userId
      });
    }
  }

  // フォロワー取得メソッド
  async getFollowers(userId) {
    try {
      return await this.prisma.follow.findMany({
        where: { followingId: this.validateId(userId) },
        include: {
          follower: {
            include: {
              profile: true,
              userRoles: {
                include: { role: true }
              }
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      });
    } catch (error) {
      this.handleError(error, {
        context: 'Get followers',
        userId
      });
    }
  }

  // フォロー推奨ユーザー取得メソッド
  async getRecommendedUsers(userId, limit = 5) {
    try {
      const validUserId = this.validateId(userId);

      // 現在のフォロー中のユーザーIDを取得
      const following = await this.prisma.follow.findMany({
        where: { followerId: validUserId },
        select: { followingId: true }
      });
      const followingIds = following.map(f => f.followingId);

      // 推奨ユーザーを取得（フォロー中以外のアクティブユーザー）
      return await this.prisma.user.findMany({
        where: {
          id: {
            not: validUserId,
            notIn: followingIds
          },
          microposts: {
            some: {} // 投稿があるユーザーのみ
          }
        },
        include: {
          profile: true,
          _count: {
            select: {
              followers: true,
              microposts: true
            }
          }
        },
        orderBy: {
          followers: {
            _count: 'desc'
          }
        },
        take: limit
      });
    } catch (error) {
      this.handleError(error, {
        context: 'Get recommended users',
        userId
      });
    }
  }
}

// モジュールエクスポート
module.exports = {
  AuthService,
  ProfileService,
  MicropostService,
  SystemService,
  CategoryService,
  FollowService,
  PassportService,
  LikeService,
  CommentService,
  NotificationService
}; 