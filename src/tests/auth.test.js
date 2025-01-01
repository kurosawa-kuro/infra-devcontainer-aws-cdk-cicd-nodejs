const request = require('supertest');
const { getTestServer, TEST_USER, TEST_ADMIN } = require('./test-setup');

describe('Authentication Integration Tests', () => {
  const testServer = getTestServer();
  let server;
  let prisma;

  beforeAll(async () => {
    server = testServer.getServer();
    prisma = testServer.getPrisma();
  });

  describe('User Registration', () => {
    it('should successfully register a new user with default role', async () => {
      const { response, user } = await testServer.createTestUser(TEST_USER, false);
      expect(response.status).toBe(302);
      expect(response.header.location).toBe('/');
      expect(response.headers['set-cookie']).toBeTruthy();

      expect(user).toBeTruthy();
      expect(user.email).toBe(TEST_USER.email);
      
      // ユーザーロールの検証
      expect(user.userRoles).toHaveLength(1);
      expect(user.userRoles[0].role.name).toBe('user');

      const protectedResponse = await request(server)
        .get('/microposts')
        .set('Cookie', response.headers['set-cookie'])
        .expect(200);
    });

    it('should successfully create an admin user', async () => {
      const { response, user } = await testServer.createTestUser(TEST_ADMIN, true);
      expect(response.status).toBe(302);
      expect(response.header.location).toBe('/');
      expect(response.headers['set-cookie']).toBeTruthy();

      expect(user).toBeTruthy();
      expect(user.email).toBe(TEST_ADMIN.email);
      
      // 管理者ロールの検証
      expect(user.userRoles).toHaveLength(2);
      expect(user.userRoles.map(ur => ur.role.name).sort()).toEqual(['admin', 'user']);
    });
  });

  describe('User Login', () => {
    let testUser;

    beforeEach(async () => {
      const { user } = await testServer.createTestUser(TEST_USER, false);
      testUser = user;
    });

    it('should successfully login with correct credentials', async () => {
      const { response } = await testServer.loginTestUser();
      expect(response.status).toBe(302);
      expect(response.header.location).toBe('/');
      expect(response.headers['set-cookie']).toBeTruthy();
    });

    it('should include role information in session', async () => {
      const { authCookie } = await testServer.loginTestUser();
      
      // First verify we can access the profile page
      const response = await request(server)
        .get(`/profile/${testUser.id}`)
        .set('Cookie', authCookie)
        .expect(200);

      // Verify role information is displayed
      expect(response.text).toContain(testUser.email);
      expect(response.text).toContain('user');
      expect(response.text).not.toContain('admin');

      // Also verify microposts page access (protected route)
      await request(server)
        .get('/microposts')
        .set('Cookie', authCookie)
        .expect(200);
    });
  });
}); 