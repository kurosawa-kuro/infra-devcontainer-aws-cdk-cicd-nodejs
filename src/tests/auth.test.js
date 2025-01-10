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
      console.log('Test server initialized successfully');
    } catch (error) {
      console.error('Failed to initialize test server:', error);
      throw error;
    }
    console.log('=== Auth Test Setup Complete ===\n');
  });

  beforeEach(async () => {
    await testServer.cleanDatabase();
  });

  describe('User Registration', () => {
    it('should successfully register a new user', async () => {
      console.log('\n--- Testing: User Registration ---');
      try {
        const userData = {
          email: 'user@example.com',
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
  });

  describe('User Login', () => {
    let testUser;

    beforeEach(async () => {
      const setup = await testServer.setupTestEnvironment({ 
        createUser: true,
        userData: {
          email: 'user@example.com',
          password: 'password',
          name: 'TestUser'
        }
      });
      testUser = setup.testUser;
      console.log('Test user created:', {
        id: testUser.id,
        email: testUser.email
      });
    });

    it('should successfully login with correct credentials', async () => {
      console.log('\n--- Testing: User Login ---');
      try {
        const loginData = {
          email: testUser.email,
          password: 'password',
          _csrf: 'test-csrf-token'
        };

        console.log('Login attempt with:', {
          email: loginData.email,
          password: loginData.password
        });

        const response = await agent
          .post('/auth/login')
          .send(loginData);

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('/');
        expect(response.headers['set-cookie']).toBeDefined();

        // セッション情報の確認
        const sessionResponse = await request(server)
          .get('/auth/session')
          .set('Cookie', response.headers['set-cookie']);

        expect(sessionResponse.status).toBe(200);
        expect(sessionResponse.body.user).toBeTruthy();
        expect(sessionResponse.body.user.email).toBe(testUser.email);
      } catch (error) {
        console.error('Login test failed:', {
          error: error.message,
          stack: error.stack
        });
        throw error;
      }
    });
  });

  afterAll(async () => {
    await testServer.cleanup();
  });
}); 