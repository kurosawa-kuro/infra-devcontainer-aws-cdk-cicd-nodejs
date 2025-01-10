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
          terms: 'on',
          _csrf: 'test-csrf-token'
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

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('/');

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
          roles: ['admin', 'user'],
          _csrf: 'test-csrf-token'
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

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('/');

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
          roles: createdAdmin?.userRoles?.map(ur => ur.role.name)
        });

        expect(createdAdmin).toBeTruthy();
        expect(createdAdmin.email).toBe(adminData.email);
        expect(createdAdmin.profile).toBeTruthy();
        expect(createdAdmin.userRoles).toHaveLength(2);
        expect(createdAdmin.userRoles.map(ur => ur.role.name).sort()).toEqual(['admin', 'user'].sort());
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
        console.log('Creating test user...');
        const testUser = await testServer.createTestUser();
        console.log('Test user created:', {
          id: testUser?.id,
          email: testUser?.email,
          name: testUser?.name,
          roles: testUser?.userRoles?.map(ur => ur.role.name)
        });
      } catch (error) {
        console.error('Failed to create test user:', {
          error: error.message,
          stack: error.stack
        });
        throw error;
      }
    });

    it('should successfully login with correct credentials', async () => {
      console.log('\n--- Testing: User Login ---');
      try {
        // データベースのユーザー確認
        console.log('Verifying test user in database...');
        const dbUser = await testServer.prisma.user.findUnique({
          where: { email: 'test@example.com' },
          include: {
            userRoles: {
              include: { role: true }
            }
          }
        });
        console.log('Database user found:', {
          id: dbUser?.id,
          email: dbUser?.email,
          name: dbUser?.name,
          roles: dbUser?.userRoles?.map(ur => ur.role.name)
        });

        const loginData = {
          email: 'test@example.com',
          password: 'password123',
          _csrf: 'test-csrf-token'
        };
        console.log('Attempting login with data:', loginData);

        const response = await agent
          .post('/auth/login')
          .send(loginData);

        console.log('Login response details:', {
          status: response.status,
          headers: {
            location: response.headers.location,
            'set-cookie': response.headers['set-cookie'] ? 'Present' : 'Missing'
          },
          body: response.body,
          text: response.text
        });

        // セッション情報の確認
        if (response.headers['set-cookie']) {
          console.log('Session cookie received');
          const sessionResponse = await request(server)
            .get('/auth/session')
            .set('Cookie', response.headers['set-cookie']);
          console.log('Session data:', sessionResponse.body);
        } else {
          console.log('No session cookie in response');
        }

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('/');
        expect(response.headers['set-cookie']).toBeDefined();
      } catch (error) {
        console.error('Login test failed:', {
          error: error.message,
          stack: error.stack,
          type: error.constructor.name
        });
        throw error;
      }
    });

    // it('should include role information in session', async () => {
    //   console.log('\n--- Testing: Session Role Information ---');
    //   try {
    //     const loginResponse = await testServer.loginUser('test@example.com', 'password123');
    //     const authCookie = loginResponse.headers['set-cookie'];

    //     expect(loginResponse.status).toBe(302);
    //     expect(loginResponse.headers.location).toBe('/');

    //     const agent = request.agent(server);
    //     const sessionResponse = await agent
    //       .get('/auth/session')
    //       .set('Cookie', authCookie);

    //     console.log('Session response:', {
    //       status: sessionResponse.status,
    //       body: sessionResponse.body
    //     });

    //     expect(sessionResponse.status).toBe(200);
    //     expect(sessionResponse.body.user).toBeTruthy();
    //     expect(sessionResponse.body.user.roles).toContain('user');
    //   } catch (error) {
    //     console.error('Test failed:', {
    //       error: error.message,
    //       stack: error.stack
    //     });
    //     throw error;
    //   }
    // });
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