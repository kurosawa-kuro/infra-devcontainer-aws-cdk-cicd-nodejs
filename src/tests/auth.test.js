const request = require('supertest');
const { getTestServer } = require('./test-setup');

describe('Authentication Integration Tests', () => {
  let testServer;
  let server;
  let agent;

  beforeAll(async () => {
    console.log('=== Auth Test Setup Start ===');
    try {
      testServer = getTestServer();
      await testServer.initialize();
      server = testServer.getServer();
      agent = request.agent(server);
      console.log('Test server and agent initialized successfully');
    } catch (error) {
      console.error('Failed to initialize test server:', error);
      throw error;
    }
    console.log('=== Auth Test Setup Complete ===\n');
  });

  beforeEach(async () => {
    console.log('\n=== Test Case Setup Start ===');
    try {
      await testServer.cleanDatabase();
      console.log('Database cleaned and roles initialized');
    } catch (error) {
      console.error('Setup failed:', error);
      throw error;
    }
    console.log('=== Test Case Setup Complete ===\n');
  });

  describe('User Registration', () => {
    it('should successfully register a new user with default role', async () => {
      console.log('\n--- Testing: User Registration (Default Role) ---');
      try {
        const userData = {
          email: 'test@example.com',
          password: 'password123',
          name: 'TestUser',
          terms: 'on'
        };
        console.log('Attempting to register user:', { email: userData.email, name: userData.name });

        const response = await agent
          .post('/auth/signup')
          .send(userData);

        console.log('Registration response:', {
          status: response.status,
          headers: response.headers,
          body: response.body
        });

        // 登録後のリダイレクトを期待
        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('/');

        // ユーザーが作成されたことを確認
        const createdUser = await testServer.prisma.user.findUnique({
          where: { email: userData.email },
          include: {
            profile: true,
            userRoles: {
              include: { role: true }
            }
          }
        });

        console.log('Created user:', {
          id: createdUser?.id,
          email: createdUser?.email,
          name: createdUser?.name,
          profile: createdUser?.profile,
          roles: createdUser?.userRoles?.map(ur => ur.role.name)
        });

        expect(createdUser).toBeTruthy();
        expect(createdUser.email).toBe(userData.email);
        expect(createdUser.profile).toBeTruthy();
        expect(createdUser.userRoles).toHaveLength(1);
        expect(createdUser.userRoles[0].role.name).toBe('user');
      } catch (error) {
        console.error('Test failed:', {
          error: error.message,
          stack: error.stack
        });
        throw error;
      }
    });

    it('should successfully create an admin user', async () => {
      console.log('\n--- Testing: Admin User Registration ---');
      try {
        const adminData = {
          email: 'admin@example.com',
          password: 'admin123',
          name: 'AdminUser',
          terms: 'on',
          role: 'ADMIN'
        };
        console.log('Attempting to register admin:', { email: adminData.email, name: adminData.name });

        const response = await agent
          .post('/auth/signup')
          .send(adminData);

        console.log('Registration response:', {
          status: response.status,
          headers: response.headers,
          body: response.body
        });

        // 登録後のリダイレクトを期待
        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('/');

        // 管理者ユーザーが作成されたことを確認
        const createdAdmin = await testServer.prisma.user.findUnique({
          where: { email: adminData.email },
          include: {
            profile: true,
            userRoles: {
              include: { role: true }
            }
          }
        });

        console.log('Created admin:', {
          id: createdAdmin?.id,
          email: createdAdmin?.email,
          name: createdAdmin?.name,
          profile: createdAdmin?.profile,
          roles: createdAdmin?.userRoles?.map(ur => ur.role.name)
        });

        expect(createdAdmin).toBeTruthy();
        expect(createdAdmin.email).toBe(adminData.email);
        expect(createdAdmin.profile).toBeTruthy();
        expect(createdAdmin.userRoles).toHaveLength(2);
        expect(createdAdmin.userRoles.map(ur => ur.role.name)).toContain('admin');
      } catch (error) {
        console.error('Test failed:', {
          error: error.message,
          stack: error.stack
        });
        throw error;
      }
    });
  });

  describe('User Login', () => {
    beforeEach(async () => {
      console.log('\n--- Setting up test user for login tests ---');
      try {
        // テストユーザーを作成
        const userData = {
          email: 'test@example.com',
          password: '$2b$10$K.0HwpsoPDGaB/atHp0.YOYZWGqxRm6hK3o3tgB.4kBSDGZEQw0iK', // 'password123'のハッシュ
          name: 'TestUser'
        };

        // ユーザーを作成
        const user = await testServer.prisma.user.create({
          data: {
            ...userData,
            profile: {
              create: {
                avatarPath: '/uploads/default-avatar.png'
              }
            },
            userRoles: {
              create: {
                role: {
                  connectOrCreate: {
                    where: { name: 'user' },
                    create: {
                      name: 'user',
                      description: 'Regular user role'
                    }
                  }
                }
              }
            }
          }
        });

        console.log('Test user created:', {
          id: user.id,
          email: user.email,
          name: user.name
        });
      } catch (error) {
        console.error('Failed to create test user:', error);
        throw error;
      }
    });

    it('should successfully login with correct credentials', async () => {
      console.log('\n--- Testing: User Login ---');
      try {
        const loginData = {
          email: 'test@example.com',
          password: 'password123'
        };
        console.log('Attempting login:', { email: loginData.email });

        const response = await agent
          .post('/auth/login')
          .send(loginData);

        console.log('Login response:', {
          status: response.status,
          headers: response.headers,
          body: response.body
        });

        // ログイン後のリダイレクトを期待
        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('/');
        expect(response.headers['set-cookie']).toBeDefined();
      } catch (error) {
        console.error('Test failed:', {
          error: error.message,
          stack: error.stack
        });
        throw error;
      }
    });

    it('should include role information in session', async () => {
      console.log('\n--- Testing: Session Role Information ---');
      try {
        // ログイン
        const loginResponse = await agent
          .post('/auth/login')
          .send({
            email: 'test@example.com',
            password: 'password123'
          });

        console.log('Login response:', {
          status: loginResponse.status,
          headers: loginResponse.headers,
          body: loginResponse.body
        });

        expect(loginResponse.status).toBe(302);
        expect(loginResponse.headers.location).toBe('/');

        // セッション情報を確認
        const sessionResponse = await agent.get('/auth/session');
        console.log('Session response:', {
          status: sessionResponse.status,
          body: sessionResponse.body
        });

        expect(sessionResponse.status).toBe(200);
        expect(sessionResponse.body.user).toBeTruthy();
        expect(sessionResponse.body.user.roles).toContain('user');
      } catch (error) {
        console.error('Test failed:', {
          error: error.message,
          stack: error.stack
        });
        throw error;
      }
    });
  });

  afterAll(async () => {
    console.log('\n=== Cleanup Start ===');
    try {
      await testServer.cleanup();
      console.log('Cleanup completed successfully');
    } catch (error) {
      console.error('Cleanup failed:', error);
    }
    console.log('=== Cleanup Complete ===\n');
  });
}); 