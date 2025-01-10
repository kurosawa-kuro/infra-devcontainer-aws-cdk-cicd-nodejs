const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const Application = require('../app');

class TestServer {
  constructor() {
    this.prisma = new PrismaClient();
    this.app = null;
    this.server = null;
  }

  async initialize() {
    console.log('Initializing test server...');
    const application = new Application();
    this.app = application;
    this.server = await application.initialize();
    console.log('Test server initialized');
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
      console.log('Cleaned notifications');

      // 2. いいね関連
      await this.prisma.like.deleteMany();
      console.log('Cleaned likes');

      // 3. コメント関連
      await this.prisma.comment.deleteMany();
      console.log('Cleaned comments');

      // 4. マイクロポストとカテゴリーの関連
      await this.prisma.categoryMicropost.deleteMany();
      console.log('Cleaned category-micropost relations');

      // 5. マイクロポスト
      await this.prisma.micropost.deleteMany();
      console.log('Cleaned microposts');

      // 6. カテゴリー
      await this.prisma.category.deleteMany();
      console.log('Cleaned categories');

      // 7. ユーザープロフィール
      await this.prisma.userProfile.deleteMany();
      console.log('Cleaned user profiles');

      // 8. フォロー関係
      await this.prisma.follow.deleteMany();
      console.log('Cleaned follows');

      // 9. ユーザーロール
      await this.prisma.userRole.deleteMany();
      console.log('Cleaned user roles');

      // 10. ロール
      await this.prisma.role.deleteMany();
      console.log('Cleaned roles');

      // 11. ユーザー
      await this.prisma.user.deleteMany();
      console.log('Cleaned users');

      // デフォルトロールの作成
      await this.setupDefaultRoles();

      console.log('=== Database Cleanup Complete ===\n');
    } catch (error) {
      console.error('Database cleanup failed:', error);
      throw error;
    }
  }

  async setupDefaultRoles() {
    console.log('\n=== Setting up default roles ===');
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

      console.log('Default roles created:', roles.map(r => r.name));
      console.log('=== Role setup complete ===\n');
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