const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const axios = require('axios');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// ベース抽象クラス - 共通機能を提供
class BaseService {
  constructor(prisma, logger) {
    this.prisma = prisma;
    this.logger = logger;
  }

  logError(error, context = {}) {
    this.logger.error({
      message: error.message,
      stack: error.stack,
      ...context
    });
  }

  // 共通のユーティリティメソッド
  validateId(id) {
    const parsedId = parseInt(id, 10);
    if (isNaN(parsedId)) {
      throw new Error('Invalid ID format');
    }
    return parsedId;
  }

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
}

// 認証関連サービス
class AuthService extends BaseService {
  async signup({ email, password, passwordConfirmation, name }) {
    // バリデーション
    if (!email || !password || !name) {
      throw new Error('メールアドレス、パスワード、お名前は必須です');
    }

    if (password !== passwordConfirmation) {
      throw new Error('パスワードが一致しません');
    }

    if (!name.match(/^[a-zA-Z0-9]+$/)) {
      throw new Error('お名前は半角英数字のみ使用可能です');
    }

    // 既存ユーザーチェック
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new Error('このメールアドレスは既に登録されています');
    }

    // ユーザー作成
    const hashedPassword = await bcrypt.hash(password, 10);
    const userRole = await this.prisma.role.findUnique({ where: { name: 'user' } });
    if (!userRole) {
      throw new Error('デフォルトのユーザーロールが見つかりません');
    }

    return this.prisma.user.create({
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
  }

  async login(req, res) {
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

      const logoutCallback = (err) => {
        if (err) {
          this.logger.error('Logout error:', err);
          reject(err);
          return;
        }

        if (req.session) {
          req.session.destroy((err) => {
            if (err) {
              this.logger.error('Session destruction error:', err);
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
}

// プロフィール関連サービス
class ProfileService extends BaseService {
  constructor(prisma, logger) {
    super(prisma, logger);
    this.followService = new FollowService(prisma, logger);
  }

  async getUserProfile(userId) {
    return this.prisma.user.findUnique({
      where: { id: this.validateId(userId) },
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

  async getUserProfileByName(name) {
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

  async getMicropostsByUser(userId) {
    return this.prisma.micropost.findMany({
      where: { userId: this.validateId(userId) },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true
          }
        }
      }
    });
  }

  async updateProfile(userId, profileData) {
    const parsedId = this.validateId(userId);

    if (profileData.name && !profileData.name.match(/^[a-zA-Z0-9]+$/)) {
      throw new Error('お名前は半角英数字のみ使用可能です');
    }

    const [updatedUser, updatedProfile] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: parsedId },
        data: { name: profileData.name || '' }
      }),
      this.prisma.userProfile.upsert({
        where: { userId: parsedId },
        create: {
          userId: parsedId,
          bio: profileData.bio || '',
          location: profileData.location || '',
          website: profileData.website || '',
          birthDate: profileData.birthDate ? new Date(profileData.birthDate) : null,
          avatarPath: profileData.avatarPath || 'default_avatar.png'
        },
        update: {
          bio: profileData.bio || '',
          location: profileData.location || '',
          website: profileData.website || '',
          birthDate: profileData.birthDate ? new Date(profileData.birthDate) : null,
          ...(profileData.avatarPath && { avatarPath: profileData.avatarPath })
        }
      })
    ]);

    return { ...updatedUser, profile: updatedProfile };
  }

  async updateUserRoles(userId, roleNames) {
    const parsedId = this.validateId(userId);
    const roles = await this.prisma.role.findMany({
      where: {
        name: { in: ['user', 'admin', 'read-only-admin'] }
      }
    });

    const roleMap = new Map(roles.map(role => [role.name, role.id]));
    const selectedRoleIds = roleNames
      .filter(name => roleMap.has(name))
      .map(name => roleMap.get(name));

    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({
        where: { userId: parsedId }
      }),
      this.prisma.userRole.createMany({
        data: selectedRoleIds.map(roleId => ({
          userId: parsedId,
          roleId
        }))
      })
    ]);

    return this.getUserProfile(parsedId);
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
}

// フォロー関連サービス
class FollowService extends BaseService {
  constructor(prisma, logger) {
    super(prisma, logger);
    this.notificationService = new NotificationService(prisma, logger);
  }

  async isFollowing(followerId, followingId) {
    const follow = await this.prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: this.validateId(followerId),
          followingId: this.validateId(followingId)
        }
      }
    });
    return !!follow;
  }

  async follow(followerId, followingId) {
    const follow = await this.prisma.follow.create({
      data: {
        followerId: this.validateId(followerId),
        followingId: this.validateId(followingId)
      }
    });

    // フォロー通知の作成
    await this.notificationService.createNotification({
      type: 'FOLLOW',
      recipientId: followingId,
      actorId: followerId
    });

    return follow;
  }

  async unfollow(followerId, followingId) {
    return this.prisma.follow.delete({
      where: {
        followerId_followingId: {
          followerId: this.validateId(followerId),
          followingId: this.validateId(followingId)
        }
      }
    });
  }

  async getFollowCounts(userId) {
    const parsedId = this.validateId(userId);
    const [followingCount, followersCount] = await Promise.all([
      this.prisma.follow.count({
        where: { followerId: parsedId }
      }),
      this.prisma.follow.count({
        where: { followingId: parsedId }
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
    return this.prisma.micropost.create({
      data: {
        title,
        imageUrl,
        userId: this.validateId(userId),
        categories: {
          create: categories.map(categoryId => ({
            categoryId: this.validateId(categoryId)
          }))
        }
      },
      include: {
        user: {
          select: {
            id: true,
            email: true }
        },
        categories: {
          include: { category: true }
        }
      }
    });
  }

  async getMicropostsByUser(userId) {
    return this.prisma.micropost.findMany({
      where: { userId: this.validateId(userId) },
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
    try {
      await this.prisma.micropostView.upsert({
        where: {
          micropostId_ipAddress: {
            micropostId: this.validateId(micropostId),
            ipAddress
          }
        },
        create: {
          micropostId: this.validateId(micropostId),
          ipAddress,
          viewedAt: new Date()
        },
        update: {
          viewedAt: new Date()
        }
      });
    } catch (error) {
      this.logger.error('Error tracking view:', {
        micropostId,
        ipAddress,
        error: error.message
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
    return this.prisma.micropost.findUnique({
      where: { id: this.validateId(micropostId) },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true
          }
        },
        categories: {
          include: { category: true }
        },
        _count: {
          select: { views: true }
        }
      }
    });
  }
}

// カテゴリ関連サービス
class CategoryService extends BaseService {
  async getAllCategories() {
    return this.prisma.category.findMany({
      include: {
        _count: {
          select: { microposts: true }
        }
      },
      orderBy: { name: 'asc' }
    });
  }

  async getCategoryById(id) {
    return this.prisma.category.findUnique({
      where: { id: this.validateId(id) },
      include: {
        microposts: {
          include: {
            micropost: {
              include: { user: true }
            }
          }
        }
      }
    });
  }
}

// システム関連サービス
class SystemService extends BaseService {
  async getInstanceMetadata() {
    if (process.env.APP_ENV === 'development') {
      return {
        publicIp: 'localhost',
        privateIp: 'localhost'
      };
    }

    try {
      const [publicIpResponse, privateIpResponse] = await Promise.all([
        axios.get('http://169.254.169.254/latest/meta-data/public-ipv4', { timeout: 2000 }),
        axios.get('http://169.254.169.254/latest/meta-data/local-ipv4', { timeout: 2000 })
      ]);
      
      return {
        publicIp: publicIpResponse.data,
        privateIp: privateIpResponse.data
      };
    } catch (error) {
      this.logError(error, { context: 'EC2 metadata fetch' });
      return {
        publicIp: 'localhost',
        privateIp: 'localhost'
      };
    }
  }

  async getHealth() {
    return { status: 'healthy' };
  }

  async getDbHealth() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'healthy' };
    } catch (err) {
      throw err;
    }
  }

  async getStats() {
    try {
      const [totalUsers, totalPosts] = await Promise.all([
        this.prisma.user.count(),
        this.prisma.micropost.count()
      ]);

      return { totalUsers, totalPosts };
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
      region: process.env.STORAGE_S3_REGION || 'ap-northeast-1',
      credentials: {
        accessKeyId: process.env.STORAGE_S3_ACCESS_KEY,
        secretAccessKey: process.env.STORAGE_S3_SECRET_KEY
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
        passwordField: 'password'
      },
      async (email, password, done) => {
        try {
          console.log('Attempting to authenticate user:', { email });
          
          const user = await this.prisma.user.findUnique({
            where: { email: email },
            include: {
              profile: true,
              userRoles: {
                include: {
                  role: true
                }
              }
            }
          });

          if (!user) {
            console.log('User not found:', { email });
            return done(null, false, { message: 'ユーザーが見つかりません' });
          }

          const isMatch = await bcrypt.compare(password, user.password);
          console.log('Password verification result:', { isMatch });
          
          if (!isMatch) {
            return done(null, false, { message: 'パスワードが間違っています' });
          }

          console.log('Authentication successful:', { userId: user.id, roles: user.userRoles.map(ur => ur.role.name) });
          return done(null, user);
        } catch (err) {
          console.error('Authentication error:', err);
          return done(err);
        }
      }
    ));

    passport.serializeUser((user, done) => {
      console.log('Serializing user:', { userId: user.id, roles: user.userRoles.map(ur => ur.role.name) });
      done(null, user.id);
    });

    passport.deserializeUser(async (id, done) => {
      try {
        console.log('Deserializing user:', { userId: id });
        const user = await this.prisma.user.findUnique({
          where: { id: id },
          include: {
            profile: true,
            userRoles: {
              include: {
                role: true
              }
            }
          }
        });
        if (!user) {
          console.log('User not found during deserialization:', { userId: id });
          return done(null, false);
        }
        console.log('Deserialization successful:', { userId: user.id, roles: user.userRoles.map(ur => ur.role.name) });
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
  constructor(prisma, logger) {
    super(prisma, logger);
    this.notificationService = new NotificationService(prisma, logger);
  }

  async like(userId, micropostId) {
    const validUserId = this.validateId(userId);
    const validMicropostId = this.validateId(micropostId);

    const like = await this.prisma.like.createMany({
      data: {
        userId: validUserId,
        micropostId: validMicropostId
      },
      skipDuplicates: true
    });

    // 投稿の作成者を取得
    const micropost = await this.prisma.micropost.findUnique({
      where: { id: validMicropostId },
      select: { userId: true }
    });

    // 自分の投稿以外にいいねした場合のみ通知を作成
    if (micropost && micropost.userId !== validUserId) {
      await this.notificationService.createNotification({
        type: 'LIKE',
        recipientId: micropost.userId,
        actorId: validUserId,
        micropostId: validMicropostId
      });
    }

    return this.prisma.like.findUnique({
      where: {
        userId_micropostId: {
          userId: validUserId,
          micropostId: validMicropostId
        }
      }
    });
  }

  async unlike(userId, micropostId) {
    const like = await this.prisma.like.findUnique({
      where: {
        userId_micropostId: {
          userId: this.validateId(userId),
          micropostId: this.validateId(micropostId)
        }
      }
    });

    if (!like) {
      return null;
    }

    return this.prisma.like.delete({
      where: {
        userId_micropostId: {
          userId: this.validateId(userId),
          micropostId: this.validateId(micropostId)
        }
      }
    });
  }

  async isLiked(userId, micropostId) {
    const like = await this.prisma.like.findUnique({
      where: {
        userId_micropostId: {
          userId: this.validateId(userId),
          micropostId: this.validateId(micropostId)
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
    return this.prisma.like.findMany({
      where: { micropostId: this.validateId(micropostId) },
      include: {
        user: {
          include: { profile: true }
        }
      }
    });
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

class CommentService {
  constructor(prisma, logger) {
    this.prisma = prisma;
    this.logger = logger;
    this.notificationService = new NotificationService(prisma, logger);
  }

  async createComment({ content, userId, micropostId }) {
    const comment = await this.prisma.comment.create({
      data: {
        content,
        userId,
        micropostId
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
    if (comment.micropost.userId !== userId) {
      await this.notificationService.createNotification({
        type: 'COMMENT',
        recipientId: comment.micropost.userId,
        actorId: userId,
        micropostId,
        commentId: comment.id
      });
    }

    return comment;
  }

  async getCommentsByMicropostId(micropostId) {
    return this.prisma.comment.findMany({
      where: { micropostId },
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
  constructor(prisma, logger) {
    super(prisma, logger);
  }

  async getNotifications(userId) {
    return this.prisma.notification.findMany({
      where: {
        recipientId: userId
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
  }

  async markAsRead(notificationId, userId) {
    return this.prisma.notification.update({
      where: {
        id: notificationId,
        recipientId: userId
      },
      data: {
        read: true
      }
    });
  }

  async getUnreadCount(userId) {
    return this.prisma.notification.count({
      where: {
        recipientId: userId,
        read: false
      }
    });
  }

  async createNotification({ type, recipientId, actorId, micropostId = null, commentId = null }) {
    // 通知タイプの検証
    const validTypes = ['FOLLOW', 'LIKE', 'COMMENT'];
    if (!validTypes.includes(type)) {
      throw new Error('Invalid notification type');
    }

    return this.prisma.notification.create({
      data: {
        type,
        recipientId: this.validateId(recipientId),
        actorId: this.validateId(actorId),
        micropostId: micropostId ? this.validateId(micropostId) : null,
        commentId: commentId ? this.validateId(commentId) : null,
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