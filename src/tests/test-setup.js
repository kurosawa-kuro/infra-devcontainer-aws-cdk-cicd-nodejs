const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const Application = require('../app');
const bcrypt = require('bcrypt');

class TestServer {
  constructor() {
    this.prisma = new PrismaClient();
    this.app = null;
    this.server = null;
  }

  async initialize() {
    const application = new Application();
    this.app = application;
    this.server = await application.initialize();
  }

  getServer() {
    return this.server;
  }

  getPrisma() {
    return this.prisma;
  }

  async cleanDatabase() {
    console.log('\n=== Database Cleanup Start ===');
    try {
      // 依存関係の順序に従って削除
      // 1. 通知関連
      await this.prisma.notification.deleteMany();

      // 2. いいね関連
      await this.prisma.like.deleteMany();

      // 3. コメント関連
      await this.prisma.comment.deleteMany();

      // 4. マイクロポストとカテゴリーの関連
      await this.prisma.categoryMicropost.deleteMany();

      // 5. マイクロポスト
      await this.prisma.micropost.deleteMany();

      // 6. カテゴリー
      await this.prisma.category.deleteMany();

      // 7. ユーザープロフィール
      await this.prisma.userProfile.deleteMany();

      // 8. フォロー関係
      await this.prisma.follow.deleteMany();

      // 9. ユーザーロール
      await this.prisma.userRole.deleteMany();

      // 10. ロール
      await this.prisma.role.deleteMany();

      // 11. ユーザー
      await this.prisma.user.deleteMany();

      // デフォルトロールの作成
      await this.setupDefaultRoles();
    } catch (error) {
      console.error('Database cleanup failed:', error);
      throw error;
    }
  }

  async setupDefaultRoles() {
    try {
      const roles = [
        { name: 'user', description: 'Regular user role' },
        { name: 'admin', description: 'Administrator role' },
        { name: 'read-only-admin', description: 'Read-only administrator role' }
      ];

      for (const role of roles) {
        await this.prisma.role.upsert({
          where: { name: role.name },
          update: {},
          create: role
        });
      }
      console.log('Default roles setup completed');
    } catch (error) {
      console.error('Failed to setup default roles:', error);
      throw error;
    }
  }

  async setupTestEnvironment({ createUser = false } = {}) {
    console.log('Setting up test environment...');
    let testUser;
    let authCookie;

    if (createUser) {
      // テストユーザーの作成
      testUser = await this.prisma.user.create({
        data: {
          email: 'admin@example.com',
          password: '$2b$10$K.0HwpsoPDGaB/atHp0.YOYZWGqxRm6hK3o3tgB.4kBSDGZEQw0iK', // 'password'のハッシュ
          name: 'AdminUser123',
          profile: {
            create: {
              avatarPath: '/uploads/default-avatar.png'
            }
          },
          userRoles: {
            create: {
              role: {
                connect: { name: 'user' }
              }
            }
          }
        },
        include: {
          profile: true,
          userRoles: {
            include: { role: true }
          }
        }
      });

      // ログインリクエストの実行
      const loginResponse = await request(this.server)
        .post('/auth/login')
        .send({
          email: 'admin@example.com',
          password: 'password'
        });

      // Cookieの取得
      authCookie = loginResponse.headers['set-cookie'];
      console.log('Login response status:', loginResponse.status);
      console.log('Auth cookie received:', !!authCookie);
    }

    return { testUser, authCookie };
  }

  authenticatedRequest(authCookie) {
    return request.agent(this.server).set('Cookie', authCookie);
  }

  async createOtherTestUser() {
    return await this.prisma.user.create({
      data: {
        email: 'other@example.com',
        password: '$2b$10$K.0HwpsoPDGaB/atHp0.YOYZWGqxRm6hK3o3tgB.4kBSDGZEQw0iK',
        name: 'OtherUser',
        profile: {
          create: {
            avatarPath: '/uploads/default-avatar.png'
          }
        },
        userRoles: {
          create: {
            role: {
              connect: { name: 'user' }
            }
          }
        }
      }
    });
  }

  async createTestUser() {
    try {
      console.log('Creating test user...');
      
      // パスワードのハッシュ化
      const hashedPassword = await bcrypt.hash('password123', 10);

      const user = await this.prisma.user.create({
        data: {
          email: 'test@example.com',
          password: hashedPassword,
          name: 'TestUser',
          userRoles: {
            create: {
              role: {
                connect: {
                  name: 'user'
                }
              }
            }
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
          }
        }
      });

      console.log('Test user created successfully:', {
        id: user.id,
        email: user.email,
        roles: user.userRoles.map(ur => ur.role.name)
      });

      return user;
    } catch (error) {
      console.error('Failed to create test user:', error);
      throw error;
    }
  }

  async loginUser(email, password) {
    console.log(`Attempting to login user: ${email}`);
    const response = await request(this.server)
      .post('/auth/login')
      .send({
        email,
        password,
        _csrf: 'test-csrf-token'
      });
    
    console.log('Login response:', {
      status: response.status,
      location: response.headers.location
    });
    
    return response;
  }

  async cleanup() {
    if (this.prisma) {
      await this.prisma.$disconnect();
    }
    console.log('Test server closed');
  }
}

let testServer;

function getTestServer() {
  if (!testServer) {
    testServer = new TestServer();
    testServer.initialize();
  }
  return testServer;
}

afterAll(async () => {
  if (testServer) {
    await testServer.cleanup();
  }
});

module.exports = {
  getTestServer
}; 