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
}

// フォロー関連サービス
class FollowService extends BaseService {
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
    return this.prisma.follow.create({
      data: {
        followerId: this.validateId(followerId),
        followingId: this.validateId(followingId)
      }
    });
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
            userRoles: {
              include: { role: true }
            }
          }
        },
        categories: {
          include: { category: true }
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

module.exports = {
  AuthService,
  ProfileService,
  MicropostService,
  SystemService,
  CategoryService,
  LogUploader,
  FollowService,
  PassportService
}; 