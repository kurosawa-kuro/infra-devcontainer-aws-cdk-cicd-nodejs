const request = require('supertest');
const { getTestServer } = require('../test-setup');

describe('ユーザープロフィール機能の統合テスト', () => {
  let testServer;
  let server;
  let testUser;
  let authCookie;

  beforeAll(async () => {
    console.log('=== Test Setup Start ===');
    testServer = await getTestServer();
    server = testServer.getServer();
    console.log('Server initialized successfully');
  });

  beforeEach(async () => {
    await testServer.database.clean();
    const setup = await testServer.setupTestEnvironment({ createUser: true });
    testUser = setup.testUser;
    authCookie = setup.authCookie;
  });

  describe('プロフィール表示', () => {
    it('未認証ユーザーでもプロフィール情報を取得できること', async () => {
      const response = await request(server)
        .get(`/users/${testUser.name}`)
        .set('Accept', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.profile).toBeTruthy();
      expect(response.body.profile.user.name).toBe(testUser.name);
    });
  });

  afterAll(async () => {
    await testServer.cleanup();
  });
}); 