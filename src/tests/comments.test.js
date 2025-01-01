const request = require('supertest');
const { getTestServer } = require('./setup');
const { createTestUserAndLogin, createTestMicroposts, TEST_ADMIN, ensureRolesExist } = require('./utils/test-utils');

describe('Comment Integration Tests', () => {
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
    await prisma.comment.deleteMany({});
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
        title: 'Test post for comments',
        userId: testUser.id
      }
    });
  });

  describe('Comment Display', () => {
    it('should show no comments message when there are no comments', async () => {
      const response = await request(server)
        .get(`/microposts/${testMicropost.id}`)
        .set('Cookie', authCookie)
        .expect(200);

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

      const response = await request(server)
        .get(`/microposts/${testMicropost.id}`)
        .set('Cookie', authCookie)
        .expect(200);

      expect(response.text).toContain(commentContent);
      expect(response.text).toContain(testUser.name);
      expect(response.text).not.toContain('まだコメントはありません。');
    });
  });

  describe('Comment Creation', () => {
    it('should successfully add a comment to a micropost', async () => {
      const commentContent = 'This is a test comment';
      const response = await request(server)
        .post(`/microposts/${testMicropost.id}/comments`)
        .set('Cookie', authCookie)
        .send({ content: commentContent })
        .expect(302); // Redirects back to the micropost page

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
      const pageResponse = await request(server)
        .get(`/microposts/${testMicropost.id}`)
        .set('Cookie', authCookie)
        .expect(200);

      expect(pageResponse.text).toContain(commentContent);
      expect(pageResponse.text).toContain(testUser.name);
      expect(pageResponse.text).not.toContain('まだコメントはありません。');
    });
  });
}); 