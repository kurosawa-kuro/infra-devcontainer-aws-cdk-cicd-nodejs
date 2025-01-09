const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const axios = require('axios');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const PATHS = {
  DEFAULT_AVATAR: process.env.DEFAULT_AVATAR_PATH,
  UPLOAD_DIR: process.env.UPLOAD_DIR_PATH,
  PUBLIC_DIR: process.env.PUBLIC_DIR_PATH
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

// 通知タイプの定義
const NotificationType = {
  FOLLOW: 'FOLLOW',
  LIKE: 'LIKE',
  COMMENT: 'COMMENT'
};

// ベース抽象クラス - 共通機能を提供
class BaseService {
  constructor(prisma, logger) {
    this.prisma = prisma;
    this.logger = logger;
    
    if (!this.logger) {
      throw new Error('Logger is not initialized in BaseService');
    }
  }

  validateId(id) {
    return ValidationUtils.validateId(id);
  }

  logError(error, context = {}) {
    this.logger.error('Service error occurred', {
      ...context,
      error: error.message,
      stack: error.stack,
      name: error.name
    });
  }

  // 共通のユーティリティメソッド
  async findUserById(userId) {
    return this.prisma.user.findUnique({
      where: { id: this.validateId(userId) },
      include: {
        profile: true,
        userRoles: {
          include: {
            role: true
          }
        },
        _count: {
          select: { microposts: true }
        }
      }
    });
  }

  // 通知作成の共通メソッド
  async createNotification(type, recipientId, actorId, data = {}) {
    
    if (!Object.values(NotificationType).includes(type)) {
      throw new Error('Invalid notification type');
    }

    return this.executeTransaction(async (prisma) => {
      // アクターのプロフィルが存在することを確認
      const actor = await prisma.user.findUnique({
        where: { id: this.validateId(actorId) },
        include: { profile: true }
      });

      // if (!actor.profile) {
      //   console.log('Creating profile for actor:', actorId);
      //   // プロフィルが存在しない場合は作成
      //   await prisma.userProfile.create({
      //     data: {
      //       userId: actor.id,
      //       avatarPath: PATHS.DEFAULT_AVATAR
      //     }
      //   });
      // }

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


      return notification;
    });
  }

  // トランザクション実行の共通メソッド
  async executeTransaction(callback) {
    return this.prisma.$transaction(async (prisma) => {
      return callback(prisma);
    });
  }
}

// 認証関連サービス
class AuthService extends BaseService {
  constructor(prisma, logger) {
    super(prisma, logger);
    this.csrfTokens = new Map();
  }

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
    if (!storedData) {
      return false;
    }

    // トークンの有効期限を24時間に設定
    const tokenAge = Date.now() - storedData.createdAt;
    if (tokenAge > 24 * 60 * 60 * 1000) {
      this.csrfTokens.delete(sessionId);
      return false;
    }

    return storedData.token === token;
  }

  cleanupExpiredTokens() {
    const now = Date.now();
    for (const [sessionId, data] of this.csrfTokens.entries()) {
      if (now - data.createdAt > 24 * 60 * 60 * 1000) {
        this.csrfTokens.delete(sessionId);
      }
    }
  }

  async signup({ email, password, passwordConfirmation, name, csrfToken, sessionId }) {
    // CSRFトークン検証
    if (!this.validateCsrfToken(sessionId, csrfToken)) {
      throw new Error('Invalid CSRF token');
    }

    // バリデーション
    ValidationUtils.validateEmail(email);
    ValidationUtils.validatePassword(password, passwordConfirmation);
    ValidationUtils.validateUsername(name);

    // 既存ユーザーチェック
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new Error('このメールアドレスは既に登録されています');
    }

    return this.executeTransaction(async (prisma) => {
      const hashedPassword = await bcrypt.hash(password, 10);
      const userRole = await prisma.role.findUnique({ where: { name: 'user' } });
      
      if (!userRole) {
        throw new Error('デフォルトのユーザーロールが見つかりません');
      }

      return prisma.user.create({
        data: {
          email,
          name,
          password: hashedPassword,
          userRoles: {
            create: { roleId: userRole.id }
          }
        },
        include: {
          userRoles: {
            include: { role: true }
          }
        }
      });
    });
  }

  async login(req, res) {
    // CSRFトークンの生成と設定
    const csrfToken = this.generateCsrfToken(req.sessionID);
    res.cookie('XSRF-TOKEN', csrfToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax'
    });

    return new Promise((resolve, reject) => {
      passport.authenticate('local', (err, user, info) => {
        if (err) return reject(err);
        if (!user) return reject(new Error(info?.message || 'ログインに失敗しました'));
        
        req.logIn(user, (err) => {
          if (err) return reject(err);
          resolve(user);
        });
      })(req, res);
    });
  }

  async logout(req) {
    return new Promise((resolve, reject) => {
      if (!req.session) {
        resolve();
        return;
      }

      // CSRFトークンの削除
      this.csrfTokens.delete(req.sessionID);

      const logoutCallback = (err) => {
        if (err) {
          this.logError(err, { context: 'logout' });
          reject(err);
          return;
        }

        if (req.session) {
          req.session.destroy((err) => {
            if (err) {
              this.logError(err, { context: 'session destruction' });
              reject(err);
              return;
            }
            resolve();
          });
        } else {
          resolve();
        }
      };

      if (req.logout) {
        req.logout(logoutCallback);
      } else {
        logoutCallback();
      }
    });
  }

  // 定期的なトークンクリーンアップを開始
  startTokenCleanup() {
    setInterval(() => {
      this.cleanupExpiredTokens();
    }, 60 * 60 * 1000); // 1時間ごとに実行
  }
}

// プロフィール関連サービス
class ProfileService extends BaseService {
  constructor(prisma, logger) {
    super(prisma, logger);
    this.followService = new FollowService(prisma, logger);
  }

  // プロフィールのアバターパスを正規化する
  normalizeAvatarPath(avatarPath) {
    if (!avatarPath) return PATHS.DEFAULT_AVATAR;
    if (avatarPath.startsWith('/uploads/')) return avatarPath;
    return `/uploads/${avatarPath.replace(/^\//, '')}`;
  }

  async getUserProfile(userId) {
    return this.findUserById(userId);
  }

  async getUserProfileByName(name) {
    ValidationUtils.validateUsername(name);
    return this.prisma.user.findFirst({
      where: { name },
      include: {
        profile: true,
        userRoles: {
          include: { role: true }
        },
        _count: {
          select: { microposts: true }
        }
      }
    });
  }

  async getAllUsers() {
    return this.prisma.user.findMany({
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
  }

  async updateProfile(userId, profileData) {
    const parsedId = this.validateId(userId);
    if (profileData.name) {
      ValidationUtils.validateUsername(profileData.name);
    }

    return this.executeTransaction(async (prisma) => {
      const user = await prisma.user.update({
        where: { id: parsedId },
        data: { 
          name: profileData.name || undefined
        }
      });

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
          ...(profileData.avatarPath && { avatarPath: profileData.avatarPath })
        }
      });

      return this.findUserById(parsedId);
    });
  }

  async updateUserRoles(userId, roleNames) {
    const parsedId = this.validateId(userId);
    
    return this.executeTransaction(async (prisma) => {
      const roles = await prisma.role.findMany({
        where: {
          name: { in: roleNames }
        }
      });

      const roleMap = new Map(roles.map(role => [role.name, role.id]));
      const selectedRoleIds = roleNames
        .filter(name => roleMap.has(name))
        .map(name => roleMap.get(name));

      await prisma.userRole.deleteMany({
        where: { userId: parsedId }
      });

      await prisma.userRole.createMany({
        data: selectedRoleIds.map(roleId => ({
          userId: parsedId,
          roleId
        }))
      });

      return this.findUserById(parsedId);
    });
  }

  async getFollowCounts(userId) {
    return this.followService.getFollowCounts(userId);
  }

  async isFollowing(followerId, followingId) {
    return this.followService.isFollowing(followerId, followingId);
  }

  async getFollowing(userId) {
    return this.followService.getFollowing(userId);
  }

  async getFollowers(userId) {
    return this.followService.getFollowers(userId);
  }

  async findUserByIdentifier(identifier) {
    if (identifier.match(/^[0-9]+$/)) {
      return this.getUserProfile(parseInt(identifier, 10));
    } else {
      return this.getUserProfileByName(identifier);
    }
  }

  async createProfile(userId, profileData) {
    return await this.prisma.userProfile.create({
      data: {
        userId,
        avatarPath: profileData.avatarPath || PATHS.DEFAULT_AVATAR,
        // ... rest of the code ...
      }
    });
  }
}

// フォロー関連サービス
class FollowService extends BaseService {
  async isFollowing(followerId, followingId) {
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
  }

  async follow(followerId, followingId) {
    const validFollowerId = this.validateId(followerId);
    const validFollowingId = this.validateId(followingId);

    const follow = await this.executeTransaction(async (prisma) => {
      const follow = await prisma.follow.create({
        data: {
          followerId: validFollowerId,
          followingId: validFollowingId
        }
      });

      // フォロー通知の作成
      await this.createNotification(
        NotificationType.FOLLOW,
        validFollowingId,
        validFollowerId
      );

      return follow;
    });

    return follow;
  }

  async unfollow(followerId, followingId) {
    const validFollowerId = this.validateId(followerId);
    const validFollowingId = this.validateId(followingId);

    return this.prisma.follow.delete({
      where: {
        followerId_followingId: {
          followerId: validFollowerId,
          followingId: validFollowingId
        }
      }
    });
  }

  async getFollowCounts(userId) {
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
  }

  async getFollowing(userId) {
    return this.prisma.follow.findMany({
      where: { followerId: this.validateId(userId) },
      include: {
        following: {
          include: { profile: true }
        }
      }
    });
  }

  async getFollowers(userId) {
    return this.prisma.follow.findMany({
      where: { followingId: this.validateId(userId) },
      include: {
        follower: {
          include: { profile: true }
        }
      }
    });
  }
}

// 投稿関連サービス
class MicropostService extends BaseService {
  async getAllMicroposts() {
    return this.prisma.micropost.findMany({
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
  }

  async createMicropost({ title, imageUrl, userId, categories = [] }) {
    const validUserId = this.validateId(userId);
    const validCategories = categories.map(id => this.validateId(id));

    return this.executeTransaction(async (prisma) => {
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
  }

  async getMicropostsByUser(userId) {
    const validUserId = this.validateId(userId);
    return this.prisma.micropost.findMany({
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
  }

  async trackView(micropostId, ipAddress) {
    const validMicropostId = this.validateId(micropostId);
    try {
      return this.executeTransaction(async (prisma) => {
        return prisma.micropostView.upsert({
          where: {
            micropostId_ipAddress: {
              micropostId: validMicropostId,
              ipAddress
            }
          },
          create: {
            micropostId: validMicropostId,
            ipAddress,
            viewedAt: new Date()
          },
          update: {
            viewedAt: new Date()
          }
        });
      });
    } catch (error) {
      this.logError(error, {
        context: 'trackView',
        micropostId,
        ipAddress
      });
      throw error;
    }
  }

  async getViewCount(micropostId) {
    return this.prisma.micropostView.count({
      where: { micropostId: this.validateId(micropostId) }
    });
  }

  async getMicropostWithViews(micropostId) {
    try {
      const micropost = await this.prisma.micropost.findUnique({
        where: { id: this.validateId(micropostId) },
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
        console.log('Micropost not found:', micropostId);
        return null;
      }


      return micropost;
    } catch (error) {
      console.error('Error fetching micropost:', {
        error: error.message,
        stack: error.stack,
        micropostId
      });
      throw error;
    }
  }
}

// カテゴリ関連サービス
class CategoryService extends BaseService {
  async getAllCategories() {
    this.logger.info('Starting getAllCategories');
    try {
      this.logger.debug('Executing category query with includes');
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
      this.logger.info('Categories query completed', {
        hasRecords,
        count: categories.length,
        recordIds: hasRecords ? categories.map(c => c.id) : [],
        recordNames: hasRecords ? categories.map(c => c.name) : []
      });

      if (!hasRecords) {
        this.logger.warn('No categories found in the database');
        return [];
      }

      this.logger.info('Categories retrieved successfully', {
        count: categories.length,
        categoriesWithPosts: categories.map(c => ({
          id: c.id,
          name: c.name,
          postsCount: c._count.microposts
        }))
      });

      return categories;
    } catch (error) {
      this.logError(error, {
        method: 'getAllCategories',
        message: 'Failed to retrieve categories'
      });
      throw error;
    }
  }

  async getCategoryById(id) {
    
    let validatedId;
    try {
      validatedId = this.validateId(id);
    } catch (error) {
      console.error('ID validation failed:', {
        inputId: id,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }

    try {
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
        console.warn('Category not found:', validatedId);
        return null;
      }

      return category;
    } catch (error) {
      console.error('Query error:', error);
      throw error;
    }
  }
}

// システム関連サービス
class SystemService extends BaseService {
  async getHealth() {
    return { status: 'healthy' };
  }

  async getDbHealth() {
    try {
      await this.executeTransaction(async (prisma) => {
        await prisma.$queryRaw`SELECT 1`;
      });
      return { status: 'healthy' };
    } catch (error) {
      this.logError(error, { context: 'Database health check' });
      throw error;
    }
  }

  async getStats() {
    try {
      return this.executeTransaction(async (prisma) => {
        const [totalUsers, totalPosts] = await Promise.all([
          prisma.user.count(),
          prisma.micropost.count()
        ]);

        return { totalUsers, totalPosts };
      });
    } catch (error) {
      this.logError(error, { context: 'Getting system stats' });
      throw error;
    }
  }
}

// ログアップロード関連サービス
class LogUploader extends BaseService {
  constructor(prisma, logger) {
    super(prisma, logger);
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    });
    this.bucketName = process.env.STORAGE_S3_BUCKET;
    this.logDir = path.join(__dirname, '../logs');
  }

  async uploadFile(localPath, s3Key) {
    try {
      const fileContent = await fs.readFile(localPath);
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
        Body: fileContent,
        ContentType: 'text/plain'
      });

      await this.s3Client.send(command);
      this.logger.info(`Successfully uploaded ${localPath} to s3://${this.bucketName}/${s3Key}`);
    } catch (error) {
      this.logger.error(`Failed to upload ${localPath}: ${error.message}`);
      throw error;
    }
  }

  async rotateFile(filePath) {
    const timestamp = new Date().toISOString().slice(0, 10);
    const rotatedPath = `${filePath}.${timestamp}`;
    try {
      await fs.rename(filePath, rotatedPath);
      await fs.writeFile(filePath, '');
      this.logger.info(`Rotated ${filePath} to ${rotatedPath}`);
      return rotatedPath;
    } catch (error) {
      this.logger.error(`Failed to rotate ${filePath}: ${error.message}`);
      throw error;
    }
  }

  async cleanupOldLogs(baseFilename) {
    try {
      const files = await fs.readdir(this.logDir);
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

      for (const file of files) {
        if (file.startsWith(baseFilename + '.')) {
          const filePath = path.join(this.logDir, file);
          const dateStr = file.split('.').pop();
          const fileDate = new Date(dateStr);

          if (fileDate < oneWeekAgo) {
            await fs.unlink(filePath);
            this.logger.info(`Deleted old log file: ${file}`);
          }
        }
      }
    } catch (error) {
      this.logger.error(`Error cleaning up old logs: ${error.message}`);
    }
  }

  async processLogFile(filename) {
    const localPath = path.join(this.logDir, filename);
    const timestamp = new Date().toISOString().slice(0, 10);
    const s3Key = `logs/${timestamp}/${filename}`;

    try {
      const stats = await fs.stat(localPath);
      if (stats.size > 0) {
        await this.uploadFile(localPath, s3Key);
        const rotatedPath = await this.rotateFile(localPath);
        await this.cleanupOldLogs(filename);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger.error(`Error processing ${filename}: ${error.message}`);
      }
    }
  }

  async uploadLogs() {
    try {
      const logFiles = ['error.log', 'combined.log', 'batch.log'];
      for (const filename of logFiles) {
        await this.processLogFile(filename);
      }
    } catch (error) {
      this.logger.error(`Error in uploadLogs: ${error.message}`);
    }
  }
}

// パスポート関連サービス
class PassportService extends BaseService {
  configurePassport(passport) {
    passport.use(new LocalStrategy(
      { 
        usernameField: 'email',
        passwordField: 'password',
      },
      async (email, password, done) => {
        try {
          const user = await this.prisma.user.findUnique({
            where: { email: email },
            include: {
              profile: true,
              userRoles: {
                include: {
                  role: true,
                },
              },
            },
          });

          if (!user) {
            return done(null, false, { message: 'ユーザーが見つかりません' });
          }

          const isMatch = await bcrypt.compare(password, user.password);
          
          if (!isMatch) {
            return done(null, false, { message: 'パスワードが間違っています' });
          }

          return done(null, user);
        } catch (err) {
          console.error('Authentication error:', err);
          return done(err);
        }
      },
    ));

    passport.serializeUser((user, done) => {
      done(null, user.id);
    });

    passport.deserializeUser(async (id, done) => {
      try {
        const user = await this.prisma.user.findUnique({
          where: { id: id },
          include: {
            profile: true,
            userRoles: {
              include: {
                role: true,
              },
            },
          },
        });
        if (!user) {
          return done(null, false);
        }
        done(null, user);
      } catch (err) {
        console.error('Deserialization error:', err);
        done(err);
      }
    });
  }
}

// いいね関連サービス
class LikeService extends BaseService {
  async like(userId, micropostId) {
    const validUserId = this.validateId(userId);
    const validMicropostId = this.validateId(micropostId);

    return this.executeTransaction(async (prisma) => {
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
          NotificationType.LIKE,
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
  }

  async unlike(userId, micropostId) {
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

    return this.prisma.like.delete({
      where: {
        userId_micropostId: {
          userId: validUserId,
          micropostId: validMicropostId
        }
      }
    });
  }

  async isLiked(userId, micropostId) {
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
  }

  async getLikeCount(micropostId) {
    return this.prisma.like.count({
      where: { micropostId: this.validateId(micropostId) }
    });
  }

  async getLikedUsers(micropostId) {
    try {
      const likes = await this.prisma.like.findMany({
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
      return likes;
    } catch (error) {
      console.error('Error fetching liked users:', {
        error: error.message,
        micropostId
      });
      return [];
    }
  }

  async getUserLikes(userId) {
    return this.prisma.like.findMany({
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
  }
}

class CommentService extends BaseService {
  async createComment({ content, userId, micropostId }) {
    const validUserId = this.validateId(userId);
    const validMicropostId = this.validateId(micropostId);

    return this.executeTransaction(async (prisma) => {
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
          NotificationType.COMMENT,
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
  }

  async getCommentsByMicropostId(micropostId) {
    return this.prisma.comment.findMany({
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
  }
}

class NotificationService extends BaseService {
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
          micropost: true
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
                avatarPath: PATHS.DEFAULT_AVATAR
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
                micropost: true
              }
            });
          }
          return notification;
        })
      );


      return updatedNotifications;
    } catch (error) {
      console.error('Error in getNotifications:', error);
      throw error;
    }
  }

  async markAsRead(notificationId, userId) {
    const validNotificationId = this.validateId(notificationId);
    const validUserId = this.validateId(userId);

    return this.prisma.notification.update({
      where: {
        id: validNotificationId,
        recipientId: validUserId
      },
      data: {
        read: true
      }
    });
  }

  async getUnreadCount(userId) {
    return this.prisma.notification.count({
      where: {
        recipientId: this.validateId(userId),
        read: false
      }
    });
  }
}

module.exports = {
  AuthService,
  ProfileService,
  MicropostService,
  SystemService,
  CategoryService,
  LogUploader,
  FollowService,
  PassportService,
  LikeService,
  CommentService,
  NotificationService
}; 