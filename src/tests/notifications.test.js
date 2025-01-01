const request = require('supertest');
const { getTestServer } = require('./test-setup');

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
  });

  beforeEach(async () => {
    // Setup test environment with user
    const result = await testServer.setupTestEnvironment({ createUser: true });
    testUser = result.testUser;
    authCookie = result.authCookie;
    authRequest = testServer.authenticatedRequest(authCookie);

    // Create another user for interaction
    otherUser = await testServer.createOtherTestUser();

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
          recipientId: testUser.id,
          actorId: otherUser.id,
          micropostId: testMicropost.id,
          read: false
        }
      });

      const response = await authRequest.get('/notifications');
      expect(response.status).toBe(200);
      
      // 通知一覧のタイトルと説明が表示されていることを確認
      expect(response.text).toContain('通知一覧');
      expect(response.text).toContain('あなたへの通知をチェックする');

      // 通知の内容が正しく表示されていることを確認
      expect(response.text).toContain('があなたの投稿にいいねしました');
      expect(response.text).toContain('OtherUser');
      expect(response.text).toContain('新着');
      expect(response.text).toContain('投稿を見る');

      // 通知のスタイリングが正しいことを確認
      expect(response.text).toContain('border-l-rose-500');
      expect(response.text).toContain('rounded-xl');
    });
  });
}); 