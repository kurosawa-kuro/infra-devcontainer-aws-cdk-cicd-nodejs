const request = require('supertest');
const { getTestServer } = require('./setup');
const { 
  createTestUserAndLogin, 
  ensureRolesExist, 
  setupTestEnvironment,
  createOtherTestUser,
  authenticatedRequest 
} = require('./utils/test-utils');

describe('Notification Integration Tests', () => {
  const testServer = getTestServer();
  let server;
  let prisma;
  let testUser;
  let otherUser;
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

    // Create another user for interaction
    otherUser = await createOtherTestUser(prisma);

    // Create a test micropost
    testMicropost = await prisma.micropost.create({
      data: {
        title: 'Test post',
        userId: otherUser.id
      }
    });
  });

  describe('Notification Features', () => {
    it('should display notification list correctly', async () => {
      // Create test notifications
      await prisma.notification.create({
        data: {
          type: 'LIKE',
          userId: testUser.id,
          actorId: otherUser.id,
          micropostId: testMicropost.id,
          read: false
        }
      });

      const response = await authRequest.get('/notifications');
      expect(response.status).toBe(200);
      expect(response.text).toContain('Test post');
      expect(response.text).toContain(otherUser.name);
    });

    // Add more tests...
  });
}); 