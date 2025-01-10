const request = require('supertest');
const { getTestServer } = require('../test-setup');

describe('通知の公開機能の統合テスト', () => {
  let testServer;
  let server;
  let testUser;
  let testNotification;

  beforeAll(async () => {
    console.log('=== Test Setup Start ===');
    testServer = getTestServer();
    await testServer.initialize();
    server = testServer.getServer();
    console.log('Server initialized successfully');
  });

  beforeEach(async () => {
    await testServer.cleanDatabase();
    const setup = await testServer.setupTestEnvironment({ 
      createUser: true,
      userData: {
        email: 'user@example.com',
        name: 'TestUser'
      }
    });
    testUser = setup.testUser;

    // テスト用の通知を作成
    testNotification = await testServer.createTestNotification(testUser.id, {
      type: 'LIKE',
      content: 'Someone liked your post',
      isRead: false
    });
  });

  describe('通知の表示機能', () => {
    it('未ログインでもユーザーの通知一覧を取得できること', async () => {
      const response = await request(server)
        .get(`/users/${testUser.id}/notifications`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.notifications)).toBe(true);
      expect(response.body.notifications.length).toBeGreaterThan(0);
      expect(response.body.notifications[0].type).toBe('LIKE');
      expect(response.body.notifications[0].content).toBe('Someone liked your post');
      expect(response.body.notifications[0].isRead).toBe(false);
    });

    it('未ログインでもユーザーの未読通知数を取得できること', async () => {
      const response = await request(server)
        .get(`/users/${testUser.id}/notifications/unread-count`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.count).toBe(1);
    });
  });

  afterAll(async () => {
    await testServer.cleanup();
  });
}); 