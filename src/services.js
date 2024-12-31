const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const axios = require('axios');
const passport = require('passport');

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
}

class AuthService extends BaseService {
  async signup(userData) {
    const { email, password, passwordConfirmation } = userData;
    
    if (!email || !password) {
      throw new Error('メールアドレスとパスワードは必須です');
    }

    if (password !== passwordConfirmation) {
      throw new Error('パスワードが一致しません');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email }
    });
    
    if (existingUser) {
      throw new Error('このメールアドレスは既に登録されています');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const userRole = await this.prisma.role.findUnique({
      where: { name: 'user' }
    });

    if (!userRole) {
      throw new Error('デフォルトのユーザーロールが見つかりません');
    }

    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        userRoles: {
          create: {
            roleId: userRole.id
          }
        }
      },
      include: {
        userRoles: {
          include: {
            role: true
          }
        }
      }
    });

    return user;
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
      req.logout((err) => {
        if (err) return reject(err);
        if (req.session) {
          req.session.destroy((err) => {
            if (err) return reject(err);
            resolve();
          });
        } else {
          resolve();
        }
      });
    });
  }
}

class ProfileService extends BaseService {
  async getUserProfile(userId) {
    return this.prisma.user.findUnique({
      where: { id: parseInt(userId, 10) },
      include: {
        profile: true,
        userRoles: {
          include: {
            role: true
          }
        }
      }
    });
  }

  async updateProfile(userId, profileData) {
    const parsedId = parseInt(userId, 10);

    const updatedUser = await this.prisma.user.update({
      where: { id: parsedId },
      data: {
        name: profileData.name || '',
      }
    });

    const updatedProfile = await this.prisma.userProfile.upsert({
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
    });

    return {
      ...updatedUser,
      profile: updatedProfile
    };
  }
}

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
              include: {
                role: true
              }
            }
          }
        }
      }
    });
  }

  async createMicropost(data) {
    return this.prisma.micropost.create({
      data: {
        title: data.title,
        imageUrl: data.imageUrl,
        userId: data.userId
      },
      include: {
        user: {
          select: {
            id: true,
            email: true
          }
        }
      }
    });
  }
}

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
}

module.exports = {
  AuthService,
  ProfileService,
  MicropostService,
  SystemService
}; 