const request = require('supertest');
const { getTestServer } = require('./setup');
const { TEST_USER, TEST_ADMIN, createTestUser, loginTestUser, ensureRolesExist } = require('./utils/test-utils');

describe('Authentication Integration Tests', () => {
  const testServer = getTestServer();
  let server;
  let prisma;

  beforeAll(async () => {
    server = testServer.getServer();
    prisma = testServer.getPrisma();
    await ensureRolesExist(prisma);
  });

  describe('User Registration', () => {
    it('should successfully register a new user with default role', async () => {
      const response = await createTestUser(server);
      expect(response.status).toBe(302);
      expect(response.header.location).toBe('/');

      const user = await prisma.user.findUnique({
        where: { email: TEST_USER.email },
        include: {
          userRoles: {
            include: {
              role: true
            }
          }
        }
      });
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
      const response = await createTestUser(server, TEST_ADMIN, true);
      expect(response.status).toBe(302);
      expect(response.header.location).toBe('/');

      const user = await prisma.user.findUnique({
        where: { email: TEST_ADMIN.email },
        include: {
          userRoles: {
            include: {
              role: true
            }
          }
        }
      });
      expect(user).toBeTruthy();
      expect(user.email).toBe(TEST_ADMIN.email);
      
      // 管理者ロールの検証
      expect(user.userRoles).toHaveLength(2);
      expect(user.userRoles.map(ur => ur.role.name).sort()).toEqual(['admin', 'user']);
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

    it('should include role information in session', async () => {
      const { authCookie } = await loginTestUser(server);
      
      const response = await request(server)
        .get('/profile/1')
        .set('Cookie', authCookie)
        .expect(200);

      expect(response.text).toContain('user');
      expect(response.text).not.toContain('admin');
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

  describe('Role-based Access Control', () => {
    let userCookie;
    let adminCookie;
    let regularUser;
    let adminUser;

    beforeEach(async () => {
      // Create regular user
      const userResult = await createTestUser(server, TEST_USER)
        .then(() => loginTestUser(server, TEST_USER));
      userCookie = userResult.authCookie;
      regularUser = await prisma.user.findUnique({
        where: { email: TEST_USER.email }
      });

      // Create admin user
      const adminResult = await createTestUser(server, TEST_ADMIN, true)
        .then(() => loginTestUser(server, TEST_ADMIN));
      adminCookie = adminResult.authCookie;
      adminUser = await prisma.user.findUnique({
        where: { email: TEST_ADMIN.email }
      });
    });

    it('should allow admin to access any profile', async () => {
      await request(server)
        .get(`/profile/${regularUser.id}/edit`)
        .set('Cookie', adminCookie)
        .expect(200);
    });

    it('should not allow regular user to access other profiles', async () => {
      await request(server)
        .get(`/profile/${adminUser.id}/edit`)
        .set('Cookie', userCookie)
        .expect(403);
    });

    it('should allow users to access their own profile', async () => {
      await request(server)
        .get(`/profile/${regularUser.id}/edit`)
        .set('Cookie', userCookie)
        .expect(200);
    });
  });
}); 