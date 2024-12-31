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
    const { email, password, passwordConfirmation, name } = userData;
    
    if (!email || !password || !name) {
      throw new Error('メールアドレス、パスワード、お名前は必須です');
    }

    if (password !== passwordConfirmation) {
      throw new Error('パスワードが一致しません');
    }

    if (!name.match(/^[a-zA-Z0-9]+$/)) {
      throw new Error('お名前は半角英数字のみ使用可能です');
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
        name,
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
        },
        _count: {
          select: {
            microposts: true
          }
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
          include: {
            role: true
          }
        },
        _count: {
          select: {
            microposts: true
          }
        }
      }
    });
  }

  async getAllUsers() {
    return this.prisma.user.findMany({
      include: {
        profile: true,
        userRoles: {
          include: {
            role: true
          }
        },
        _count: {
          select: {
            microposts: true
          }
        }
      },
      orderBy: {
        id: 'desc'
      }
    });
  }

  async getMicropostsByUser(userId) {
    return this.prisma.micropost.findMany({
      where: {
        userId: parseInt(userId, 10)
      },
      orderBy: {
        createdAt: 'desc'
      },
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
    const parsedId = parseInt(userId, 10);

    if (profileData.name && !profileData.name.match(/^[a-zA-Z0-9]+$/)) {
      throw new Error('お名前は半角英数字のみ使用可能です');
    }

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

  async updateUserRoles(userId, roleNames) {
    const parsedId = parseInt(userId, 10);

    // Get all available roles
    const roles = await this.prisma.role.findMany({
      where: {
        name: {
          in: ['user', 'admin', 'read-only-admin']
        }
      }
    });

    // Create a map of role names to role IDs
    const roleMap = new Map(roles.map(role => [role.name, role.id]));

    // Get the role IDs for the selected roles
    const selectedRoleIds = roleNames
      .filter(name => roleMap.has(name))
      .map(name => roleMap.get(name));

    // Delete all existing roles for the user
    await this.prisma.userRole.deleteMany({
      where: { userId: parsedId }
    });

    // Create new roles for the user
    await this.prisma.userRole.createMany({
      data: selectedRoleIds.map(roleId => ({
        userId: parsedId,
        roleId
      }))
    });

    // Return the updated user with roles
    return this.getUserProfile(parsedId);
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
        },
        categories: {
          include: {
            category: true
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
        userId: data.userId,
        categories: {
          create: (data.categories || []).map(categoryId => ({
            categoryId: parseInt(categoryId, 10)
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
          include: {
            category: true
          }
        }
      }
    });
  }

  async getMicropostsByUser(userId) {
    return this.prisma.micropost.findMany({
      where: { userId: parseInt(userId, 10) },
      orderBy: { createdAt: 'desc' },
      take: 10,
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

  async getStats() {
    try {
      const [totalUsers, totalPosts] = await Promise.all([
        this.prisma.user.count(),
        this.prisma.micropost.count()
      ]);

      return {
        totalUsers,
        totalPosts
      };
    } catch (error) {
      this.logError(error, { context: 'Getting system stats' });
      throw error;
    }
  }
}

class CategoryService extends BaseService {
  async getAllCategories() {
    return this.prisma.category.findMany({
      include: {
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
  }

  async getCategoryById(id) {
    return this.prisma.category.findUnique({
      where: { id: parseInt(id, 10) },
      include: {
        microposts: {
          include: {
            micropost: {
              include: {
                user: true
              }
            }
          }
        }
      }
    });
  }
}

module.exports = {
  AuthService,
  ProfileService,
  MicropostService,
  SystemService,
  CategoryService
}; 