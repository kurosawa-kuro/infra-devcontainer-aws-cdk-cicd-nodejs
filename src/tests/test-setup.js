const { PrismaClient } = require('@prisma/client');
const http = require('http');
const request = require('supertest');

// Test user constants
const TEST_USER = {
  email: 'test@example.com',
  password: 'password123',
  passwordConfirmation: 'password123',
  name: 'TestUser123',
  terms: 'on'
};

const TEST_ADMIN = {
  email: 'admin@example.com',
  password: 'admin123',
  passwordConfirmation: 'admin123',
  name: 'AdminUser123',
  terms: 'on'
};

class TestServer {
  constructor() {
    this.prisma = new PrismaClient();
    this.app = null;
    this.server = null;
    this.baseUrl = null;
    this.agent = null;
  }

  async createDefaultRoles() {
    const roles = ['user', 'admin'];
    const createdRoles = {};
    
    for (const roleName of roles) {
      createdRoles[roleName] = await this.prisma.role.upsert({
        where: { name: roleName },
        update: {},
        create: {
          name: roleName,
          description: `${roleName} role`
        }
      });
    }

    return createdRoles;
  }

  async start() {
    process.env.NODE_ENV = 'test';
    const app = require('../app');
    await app.initialize();
    this.app = app.app;

    await this.createDefaultRoles();

    this.server = http.createServer(this.app);
    await new Promise(resolve => {
      this.server.listen(0, () => {
        this.baseUrl = `http://localhost:${this.server.address().port}`;
        console.log(`Test server started on ${this.baseUrl}`);
        this.agent = request.agent(this.server);
        resolve();
      });
    });
  }

  async cleanup() {
    if (this.server) {
      await new Promise(resolve => this.server.close(resolve));
      console.log('Test server closed');
    }
    await this.prisma.$disconnect();
  }

  async resetDatabase() {
    await this.prisma.notification.deleteMany();
    await this.prisma.like.deleteMany();
    await this.prisma.comment.deleteMany();
    await this.prisma.categoryMicropost.deleteMany();
    await this.prisma.category.deleteMany();
    await this.prisma.micropost.deleteMany();
    await this.prisma.userRole.deleteMany();
    await this.prisma.userProfile.deleteMany();
    await this.prisma.follow.deleteMany();
    await this.prisma.user.deleteMany();
    await this.prisma.role.deleteMany();
    
    await this.createDefaultRoles();
  }

  // Test helper methods
  async createTestUser(isAdmin = false) {
    const email = isAdmin ? 'admin@example.com' : 'test@example.com';
    const password = 'password123';
    const name = isAdmin ? 'AdminUser123' : 'TestUser123';

    // ユーザー登録
    const response = await this.agent
      .post('/auth/signup')
      .send({
        email,
        password,
        name,
        terms: 'on',
        _csrf: 'test-csrf-token'
      });

    // ユーザー情報の取得
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        userRoles: {
          include: { role: true }
        },
        profile: true
      }
    });

    if (!user) {
      throw new Error('User not created during signup');
    }

    if (isAdmin) {
      // 管理者ロールの追加
      await this.prisma.userRole.create({
        data: {
          userId: user.id,
          role: {
            connect: {
              name: 'admin'
            }
          }
        }
      });
    }

    return user;
  }

  async loginTestUser(credentials = { 
    email: TEST_USER.email, 
    password: TEST_USER.password 
  }) {
    // CSRFトークンを取得
    const csrfResponse = await request(this.server)
      .get('/auth/login')
      .expect(200);
    const csrfToken = csrfResponse.text.match(/name="_csrf" value="([^"]+)"/)[1];

    const response = await request(this.server)
      .post('/auth/login')
      .type('form')
      .send({
        ...credentials,
        _csrf: csrfToken
      });

    if (!response.headers['set-cookie']) {
      throw new Error('No session cookie returned from login');
    }

    return {
      response,
      authCookie: response.headers['set-cookie']
    };
  }

  async logoutTestUser(authCookie) {
    const response = await request(this.server)
      .get('/auth/logout')
      .set('Cookie', authCookie);

    expect(response.status).toBe(302);
    expect(response.header.location).toBe('/auth/login');

    return response;
  }

  async createTestUserAndLogin(userData = TEST_USER, isAdmin = false) {
    const { response: signupResponse, user } = await this.createTestUser(userData, isAdmin);
    const loginResult = await this.loginTestUser({
      email: userData.email,
      password: userData.password
    });

    if (!loginResult.authCookie) {
      throw new Error('Login failed - no auth cookie');
    }

    return {
      ...loginResult,
      user
    };
  }

  async createTestMicroposts(userId, posts = [
    { title: 'First post' },
    { title: 'Second post' }
  ]) {
    return await this.prisma.micropost.createMany({
      data: posts.map(post => ({ ...post, userId }))
    });
  }

  async setupTestEnvironment(options = {}) {
    const {
      createUser = true,
      isAdmin = false,
      createMicroposts = false,
      createCategories = false
    } = options;

    let testUser;
    let authCookie;

    if (createUser) {
      const result = await this.createTestUserAndLogin(undefined, isAdmin);
      testUser = result.user;
      authCookie = result.authCookie;
    }

    if (createMicroposts && testUser) {
      await this.createTestMicroposts(testUser.id);
    }

    if (createCategories) {
      await this.prisma.category.createMany({
        data: [
          { name: 'プログラミング' },
          { name: 'インフラ' },
          { name: 'セキュリティ' }
        ]
      });
    }

    return { testUser, authCookie };
  }

  authenticatedRequest(authCookie) {
    return {
      get: (url) => request(this.server).get(url).set('Cookie', authCookie),
      post: (url, data) => request(this.server).post(url).set('Cookie', authCookie).send(data),
      put: (url, data) => request(this.server).put(url).set('Cookie', authCookie).send(data),
      delete: (url) => request(this.server).delete(url).set('Cookie', authCookie)
    };
  }

  async createOtherTestUser(email = 'other@example.com', name = 'OtherUser') {
    return await this.prisma.user.create({
      data: {
        email,
        password: '$2b$10$77777777777777777777777777777777777777777777777777',
        name,
        profile: {
          create: {
            avatarPath: '/uploads/default_avatar.png'
          }
        }
      },
      include: {
        profile: true
      }
    });
  }

  getServer() {
    return this.server;
  }

  getPrisma() {
    return this.prisma;
  }

  getBaseUrl() {
    return this.baseUrl;
  }

  getApp() {
    return this.app;
  }
}

// シングルトンインスタンス
const testServer = new TestServer();

// Jest のグローバルセットアップ
beforeAll(async () => {
  await testServer.start();
}, 30000);

afterEach(async () => {
  await testServer.resetDatabase();
}, 30000);

afterAll(async () => {
  await testServer.cleanup();
}, 30000);

module.exports = {
  getTestServer: () => testServer,
  TEST_USER,
  TEST_ADMIN
}; 