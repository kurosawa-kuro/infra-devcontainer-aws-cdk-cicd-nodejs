const request = require('supertest');
const { getTestServer } = require('./setup');
const { TEST_USER, createTestUser, loginTestUser } = require('./utils/test-utils');

describe('Authentication Integration Tests', () => {
  const testServer = getTestServer();
  let server;
  let prisma;

  beforeAll(() => {
    server = testServer.getServer();
    prisma = testServer.getPrisma();
  });

  describe('User Registration', () => {
    it('should successfully register a new user', async () => {
      const response = await createTestUser(server);
      expect(response.status).toBe(302);
      expect(response.header.location).toBe('/');

      const user = await prisma.user.findUnique({
        where: { email: TEST_USER.email }
      });
      expect(user).toBeTruthy();
      expect(user.email).toBe(TEST_USER.email);

      const protectedResponse = await request(server)
        .get('/microposts')
        .set('Cookie', response.headers['set-cookie'])
        .expect(200);
    });
  });

  describe('User Login', () => {
    beforeEach(async () => {
      await createTestUser(server);
    });

    it('should successfully login with correct credentials', async () => {
      const { response } = await loginTestUser(server);
      expect(response.status).toBe(302);
      expect(response.header.location).toBe('/');
    });
  });

  describe('User Logout', () => {
    let authCookie;

    beforeEach(async () => {
      const loginResult = await createTestUser(server)
        .then(() => loginTestUser(server));
      authCookie = loginResult.authCookie;
    });

    it('should successfully logout', async () => {
      const response = await request(server)
        .get('/auth/logout')
        .set('Cookie', authCookie)
        .expect(302);

      expect(response.header.location).toBe('/auth/login');

      const protectedResponse = await request(server)
        .get('/profile/1')
        .set('Cookie', authCookie)
        .expect(302);

      expect(protectedResponse.header.location).toBe('/auth/login');
    });
  });
}); 