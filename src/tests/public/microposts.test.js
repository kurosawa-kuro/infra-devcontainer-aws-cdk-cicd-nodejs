const request = require('supertest');
const { getTestServer } = require('../test-setup');

describe('投稿の公開機能の統合テスト', () => {
  let testServer;
  let server;
  let testUser;
  let testPost;

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
  });

  describe('投稿の表示機能', () => {
    it('未ログインでも投稿一覧を取得できること', async () => {
      const response = await request(server)
        .get('/microposts');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.posts)).toBe(true);
      expect(response.body.posts.length).toBeGreaterThan(0);
      expect(response.body.posts[0].title).toBe('Test Post');
    });

    it('未ログインでも投稿詳細を取得できること', async () => {
      const response = await request(server)
        .get(`/microposts/${testPost.id}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.post).toBeTruthy();
      expect(response.body.post.title).toBe('Test Post');
      expect(response.body.post.content).toBe('This is a test post content');
    });
  });

  afterAll(async () => {
    await testServer.cleanup();
  });
}); 