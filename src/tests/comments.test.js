const request = require('supertest');
const { getTestServer } = require('./setup');
const { 
  createTestUserAndLogin,
  ensureRolesExist,
  setupTestEnvironment,
  authenticatedRequest
} = require('./utils/test-utils');

describe('Comment Integration Tests', () => {
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
        title: 'Test post for comments',
        userId: testUser.id
      }
    });
  });

  describe('Comment Display', () => {
    it('should show no comments message when there are no comments', async () => {
      const response = await authRequest.get(`/microposts/${testMicropost.id}`);
      expect(response.status).toBe(200);
      expect(response.text).toContain('まだコメントはありません。');
    });

    it('should display existing comments on the micropost page', async () => {
      // Create a test comment
      const commentContent = 'Existing test comment';
      await prisma.comment.create({
        data: {
          content: commentContent,
          userId: testUser.id,
          micropostId: testMicropost.id
        }
      });

      const response = await authRequest.get(`/microposts/${testMicropost.id}`);
      expect(response.status).toBe(200);
      expect(response.text).toContain(commentContent);
      expect(response.text).toContain(testUser.name);
      expect(response.text).not.toContain('まだコメントはありません。');
    });
  });

  describe('Comment Creation', () => {
    it('should successfully add a comment to a micropost', async () => {
      const commentContent = 'This is a test comment';
      const response = await authRequest
        .post(`/microposts/${testMicropost.id}/comments`)
        .send({ content: commentContent });

      expect(response.status).toBe(302); // Redirects back to the micropost page

      // Verify comment in database
      const comment = await prisma.comment.findFirst({
        where: {
          userId: testUser.id,
          micropostId: testMicropost.id,
          content: commentContent
        }
      });
      expect(comment).toBeTruthy();

      // Verify comment appears on the page
      const pageResponse = await authRequest.get(`/microposts/${testMicropost.id}`);
      expect(pageResponse.status).toBe(200);
      expect(pageResponse.text).toContain(commentContent);
      expect(pageResponse.text).toContain(testUser.name);
      expect(pageResponse.text).not.toContain('まだコメントはありません。');
    });
  });
}); 