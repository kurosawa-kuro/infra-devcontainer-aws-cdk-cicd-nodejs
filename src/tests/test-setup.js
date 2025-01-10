const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const Application = require('../app');
const bcrypt = require('bcrypt');

class TestDatabase {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async clean() {
    console.log('\n=== Database Cleanup Start ===');
    try {
      const tables = [
        'notification',
        'like',
        'comment',
        'categoryMicropost',
        'micropost',
        'category',
        'userProfile',
        'follow',
        'userRole',
        'role',
        'user'
      ];

      for (const table of tables) {
        await this.prisma[table].deleteMany();
      }

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

      await Promise.all(
        roles.map(role =>
          this.prisma.role.upsert({
            where: { name: role.name },
            update: {},
            create: role
          })
        )
      );
      console.log('Default roles setup completed');
    } catch (error) {
      console.error('Failed to setup default roles:', error);
      throw error;
    }
  }
}

class TestUserFactory {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async createUser({ email, password, name, roles = ['user'] } = {}) {
    try {
      const hashedPassword = await bcrypt.hash(password || 'password', 10);

      return await this.prisma.user.create({
        data: {
          email: email || 'user@example.com',
          password: hashedPassword,
          name: name || 'TestUser',
          profile: {
            create: {
              avatarPath: '/uploads/default-avatar.png'
            }
          },
          userRoles: {
            create: roles.map(roleName => ({
              role: {
                connect: { name: roleName }
              }
            }))
          }
        },
        include: {
          profile: true,
          userRoles: {
            include: { role: true }
          }
        }
      });
    } catch (error) {
      console.error('Failed to create test user:', error);
      throw error;
    }
  }

  async createAdmin() {
    return this.createUser({
      email: 'admin@example.com',
      name: 'AdminUser',
      roles: ['admin', 'user']
    });
  }
}

class TestServer {
  static instance = null;

  static async getInstance() {
    if (!TestServer.instance) {
      TestServer.instance = new TestServer();
      await TestServer.instance.initialize();
    }
    return TestServer.instance;
  }

  constructor() {
    this.prisma = new PrismaClient();
    this.app = null;
    this.server = null;
    this.database = new TestDatabase(this.prisma);
    this.userFactory = new TestUserFactory(this.prisma);
  }

  async initialize() {
    const application = new Application();
    this.app = application;
    this.server = await application.initialize();
    return this;
  }

  getServer() {
    return this.server;
  }

  getPrisma() {
    return this.prisma;
  }

  async setupTestEnvironment({ createUser = false, userData = null } = {}) {
    let testUser = null;
    let authCookie = null;

    if (createUser) {
      testUser = await this.userFactory.createUser(userData);
      const loginResponse = await this.loginUser(testUser.email, 'password');
      authCookie = loginResponse.headers['set-cookie'];
    }

    return { testUser, authCookie };
  }

  authenticatedRequest(authCookie) {
    return request.agent(this.server).set('Cookie', authCookie);
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

  async createTestMicropost(userId, data = {}) {
    console.log('Creating test micropost...');
    const defaultData = {
      title: 'Test Post',
      ...data
    };

    const micropost = await this.prisma.micropost.create({
      data: {
        ...defaultData,
        userId: userId
      },
      include: {
        user: true,
        likes: true,
        comments: true
      }
    });

    console.log('Created test micropost:', {
      id: micropost.id,
      title: micropost.title,
      userId: micropost.userId
    });

    return micropost;
  }
}

async function getTestServer() {
  return TestServer.getInstance();
}

afterAll(async () => {
  const server = await TestServer.getInstance();
  await server.cleanup();
});

module.exports = {
  getTestServer
}; 