const request = require('supertest');
const { getTestServer } = require('./setup');
const { createTestUserAndLogin, createTestMicroposts, TEST_ADMIN, ensureRolesExist } = require('./utils/test-utils');

describe('Like Integration Tests', () => {
  const testServer = getTestServer();
  let server;
  let prisma;
  let testUser;
  let authCookie;
  let testMicropost;

  beforeAll(async () => {
    server = testServer.getServer();
    prisma = testServer.getPrisma();
    await ensureRolesExist(prisma);
  });

  beforeEach(async () => {
    // Clean up database
    await prisma.like.deleteMany({});
    await prisma.micropost.deleteMany({});
    await prisma.userProfile.deleteMany({});
    await prisma.userRole.deleteMany({});
    await prisma.user.deleteMany({});
    await ensureRolesExist(prisma);

    // Create test user and login with prisma instance
    const { user, authCookie: cookie } = await createTestUserAndLogin(server, undefined, false, prisma);
    testUser = user;
    authCookie = cookie;

    // Create a test micropost
    testMicropost = await prisma.micropost.create({
      data: {
        title: 'Test post for likes',
        userId: testUser.id
      }
    });
  });

  describe('Like Operations', () => {
    it('should successfully like a micropost', async () => {
      const response = await request(server)
        .post(`/microposts/${testMicropost.id}/like`)
        .set('Cookie', authCookie)
        .set('Accept', 'application/json')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('いいねしました');
      expect(response.body.data.likeCount).toBe(1);

      // Verify like in database
      const like = await prisma.like.findFirst({
        where: {
          userId: testUser.id,
          micropostId: testMicropost.id
        }
      });
      expect(like).toBeTruthy();
    });

    it('should successfully unlike a micropost', async () => {
      // First like the post
      await prisma.like.create({
        data: {
          userId: testUser.id,
          micropostId: testMicropost.id
        }
      });

      const response = await request(server)
        .delete(`/microposts/${testMicropost.id}/like`)
        .set('Cookie', authCookie)
        .set('Accept', 'application/json')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('いいねを取り消しました');
      expect(response.body.data.likeCount).toBe(0);

      // Verify like is removed from database
      const like = await prisma.like.findFirst({
        where: {
          userId: testUser.id,
          micropostId: testMicropost.id
        }
      });
      expect(like).toBeNull();
    });

    it('should show correct like count on micropost page', async () => {
      // Create multiple likes
      await prisma.like.createMany({
        data: [
          { userId: testUser.id, micropostId: testMicropost.id },
          // Create another user and their like
          { 
            userId: (await prisma.user.create({
              data: {
                email: 'another@example.com',
                password: 'password123',
                name: 'AnotherUser'
              }
            })).id, 
            micropostId: testMicropost.id 
          }
        ]
      });

      const response = await request(server)
        .get(`/microposts/${testMicropost.id}`)
        .set('Cookie', authCookie)
        .expect(200);

      // Check for the like count element
      expect(response.text).toMatch(/<span class="text-sm like-count">2<\/span>/);
    });
  });
}); 