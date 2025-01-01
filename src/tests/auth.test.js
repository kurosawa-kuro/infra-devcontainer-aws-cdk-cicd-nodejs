const request = require('supertest');
const { getTestServer } = require('./setup');
const { TEST_USER, TEST_ADMIN, createTestUser, loginTestUser , ensureRolesExist } = require('./utils/test-utils');

describe('Authentication Integration Tests', () => {
  const testServer = getTestServer();
  let server;
  let prisma;

  beforeAll(async () => {
    server = testServer.getServer();
    prisma = testServer.getPrisma();
    await ensureRolesExist(prisma);
  });

  beforeEach(async () => {
    // Clean up database is now handled by setup.js
  });

  describe('User Registration', () => {
    it('should successfully register a new user with default role', async () => {
      const { response, user } = await createTestUser(server, TEST_USER, false, prisma);
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
      const { response, user } = await createTestUser(server, TEST_ADMIN, true, prisma);
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
      const { user } = await createTestUser(server, TEST_USER, false, prisma);
      testUser = user;
    });

    it('should successfully login with correct credentials', async () => {
      const { response } = await loginTestUser(server);
      expect(response.status).toBe(302);
      expect(response.header.location).toBe('/');
      expect(response.headers['set-cookie']).toBeTruthy();
    });

    it('should include role information in session', async () => {
      const { authCookie } = await loginTestUser(server);
      
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
  //   let userCookie;
  //   let adminCookie;
  //   let regularUser;
  //   let adminUser;

  //   beforeEach(async () => {
  //     // Create regular user
  //     const userResult = await createTestUser(server, TEST_USER, false, prisma)
  //       .then(() => loginTestUser(server, TEST_USER));
  //     userCookie = userResult.authCookie;
  //     regularUser = await prisma.user.findUnique({
  //       where: { email: TEST_USER.email },
  //       include: {
  //         userRoles: {
  //           include: {
  //             role: true
  //           }
  //         }
  //       }
  //     });

  //     // Create admin user
  //     const adminResult = await createTestUser(server, TEST_ADMIN, true, prisma)
  //       .then(() => loginTestUser(server, TEST_ADMIN));
  //     adminCookie = adminResult.authCookie;
  //     adminUser = await prisma.user.findUnique({
  //       where: { email: TEST_ADMIN.email },
  //       include: {
  //         userRoles: {
  //           include: {
  //             role: true
  //           }
  //         }
  //       }
  //     });

  //     // Verify roles are set up correctly
  //     expect(regularUser.userRoles.some(ur => ur.role.name === 'user')).toBe(true);
  //     expect(regularUser.userRoles.some(ur => ur.role.name === 'admin')).toBe(false);
  //     expect(adminUser.userRoles.some(ur => ur.role.name === 'admin')).toBe(true);
  //   });

  //   it('should allow admin to access any profile', async () => {
  //     const response = await request(server)
  //       .get(`/profile/${regularUser.id}/edit`)
  //       .set('Cookie', adminCookie)
  //       .expect(200);

  //     expect(response.text).toContain('プロフィール編集');
  //     expect(response.text).toContain(regularUser.email);
  //   });

  //   it('should allow users to access their own profile', async () => {
  //     const response = await request(server)
  //       .get(`/profile/${regularUser.id}/edit`)
  //       .set('Cookie', userCookie)
  //       .expect(200);

  //     expect(response.text).toContain('プロフィール編集');
  //     expect(response.text).toContain(regularUser.email);
  //   });
  // });
}); 