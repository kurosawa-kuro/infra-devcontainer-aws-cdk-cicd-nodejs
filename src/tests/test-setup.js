const { PrismaClient } = require('@prisma/client');
const { Application } = require('../app');
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
    this.app = new Application();
    this.app.setupMiddleware();
    this.app.setupRoutes();
    this.app.setupErrorHandler();

    await this.createDefaultRoles();

    this.server = http.createServer(this.app.app);
    await new Promise(resolve => {
      this.server.listen(0, () => {
        this.baseUrl = `http://localhost:${this.server.address().port}`;
        console.log(`Test server started on ${this.baseUrl}`);
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
    if (this.app) {
      await this.app.cleanup();
    }
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
  async createTestUser(userData = TEST_USER, isAdmin = false) {
    const signupData = { ...userData, terms: userData.terms || 'on' };
    
    const response = await request(this.server)
      .post('/auth/signup')
      .send(signupData);

    if (!response.headers['set-cookie']) {
      throw new Error('No session cookie returned from signup');
    }

    let user = await this.prisma.user.findUnique({
      where: { email: userData.email },
      include: {
        userRoles: {
          include: {
            role: true
          }
        }
      }
    });

    if (!user) {
      throw new Error('User not created during signup');
    }

    if (isAdmin) {
      const adminRole = await this.prisma.role.findUnique({
        where: { name: 'admin' }
      });
      if (!adminRole) {
        throw new Error('Admin role not found');
      }
      await this.prisma.userRole.create({
        data: {
          userId: user.id,
          roleId: adminRole.id
        }
      });

      user = await this.prisma.user.findUnique({
        where: { email: userData.email },
        include: {
          userRoles: {
            include: {
              role: true
            }
          }
        }
      });
    }

    await this.prisma.userProfile.create({
      data: {
        userId: user.id,
        bio: isAdmin ? 'Admin bio' : 'User bio',
        location: isAdmin ? 'Admin location' : 'User location',
        website: isAdmin ? 'https://admin.com' : 'https://user.com',
        avatarPath: 'default_avatar.png'
      }
    });

    return { response, user };
  }

  async loginTestUser(credentials = { 
    email: TEST_USER.email, 
    password: TEST_USER.password 
  }) {
    const response = await request(this.server)
      .post('/auth/login')
      .send(credentials);

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
});

afterEach(async () => {
  await testServer.resetDatabase();
});

afterAll(async () => {
  await testServer.cleanup();
});

module.exports = {
  getTestServer: () => testServer,
  TEST_USER,
  TEST_ADMIN
}; 