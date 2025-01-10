const request = require('supertest');
const { getTestServer } = require('../test-setup');

describe('いいねの公開機能の統合テスト', () => {
  let testServer;
  let server;
  let testUser;
  let testPost;
  let testLike;

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

    // テスト用の投稿を作成
    testPost = await testServer.createTestMicropost(testUser.id, {
      title: 'Test Post',
      content: 'This is a test post content'
    });

    // テスト用のいいねを作成
    testLike = await testServer.createTestLike(testUser.id, testPost.id);
  });

  describe('いいねの表示機能', () => {
    it('未ログインでも投稿に紐づくいいね一覧を取得できること', async () => {
      const response = await request(server)
        .get(`/microposts/${testPost.id}/likes`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.likes)).toBe(true);
      expect(response.body.likes.length).toBeGreaterThan(0);
      expect(response.body.likes[0].user.name).toBe('TestUser');
    });

    it('未ログインでも投稿のいいね数を取得できること', async () => {
      const response = await request(server)
        .get(`/microposts/${testPost.id}/likes/count`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.count).toBe(1);
    });
  });

  afterAll(async () => {
    await testServer.cleanup();
  });
}); 