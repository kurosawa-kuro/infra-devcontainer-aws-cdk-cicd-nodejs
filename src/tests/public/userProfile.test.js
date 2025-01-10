const request = require('supertest');
const { getTestServer } = require('../test-setup');

describe('ユーザープロフィール機能の統合テスト', () => {
  let testServer;
  let server;
  let testUser;

  beforeAll(async () => {
    console.log('=== Test Setup Start ===');
    testServer = getTestServer();
    await testServer.initialize();
    server = testServer.getServer();
    console.log('Server initialized successfully');
  });

  beforeEach(async () => {
    await testServer.cleanDatabase();
    const setup = await testServer.setupTestEnvironment({ createUser: true });
    testUser = setup.testUser;
  });

  describe('プロフィール表示', () => {
    it('プロフィール情報を取得できること', async () => {
      const response = await request(server)
        .get(`/users/${testUser.id}/profile`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.profile).toBeTruthy();
      expect(response.body.profile.userId).toBe(testUser.id);
    });
  });

  afterAll(async () => {
    await testServer.cleanup();
  });
}); 