const request = require('supertest');
const { getTestServer } = require('./setup');
const { 
  createTestUserAndLogin,
  ensureRolesExist,
  setupTestEnvironment,
  createOtherTestUser,
  authenticatedRequest
} = require('./utils/test-utils');

describe('Like Integration Tests', () => {
  const testServer = getTestServer();
  let server;
  let prisma;
  let testUser;
  let authCookie;
  let testMicropost;
  let authRequest;

  beforeAll(async () => {
    server = testServer.getServer();
    prisma = testServer.getPrisma();
    await ensureRolesExist(prisma);
  });

  beforeEach(async () => {
    // Clean up database is now handled by setup.js

    // Setup test environment with user
    const result = await setupTestEnvironment(server, prisma, { createUser: true });
    testUser = result.testUser;
    authCookie = result.authCookie;
    authRequest = await authenticatedRequest(server, authCookie);

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
      const response = await authRequest
        .post(`/microposts/${testMicropost.id}/like`)
        .set('Accept', 'application/json');

      expect(response.status).toBe(200);
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

      const response = await authRequest
        .delete(`/microposts/${testMicropost.id}/like`)
        .set('Accept', 'application/json');

      expect(response.status).toBe(200);
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
      // Create another user and their like
      const otherUser = await createOtherTestUser(prisma);

      // Create multiple likes
      await prisma.like.createMany({
        data: [
          { userId: testUser.id, micropostId: testMicropost.id },
          { userId: otherUser.id, micropostId: testMicropost.id }
        ]
      });

      const response = await authRequest.get(`/microposts/${testMicropost.id}`);
      expect(response.status).toBe(200);
      expect(response.text).toMatch(/<span class="text-sm like-count">2<\/span>/);
    });
  });
}); 