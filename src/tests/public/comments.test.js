const request = require('supertest');
const { getTestServer } = require('../test-setup');

describe('コメントの公開機能の統合テスト', () => {
  let testServer;
  let server;
  let testUser;
  let testPost;
  let testComment;

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

    // テスト用のコメントを作成
    testComment = await testServer.createTestComment(testUser.id, testPost.id, {
      content: 'Test comment content'
    });
  });

  describe('コメントの表示機能', () => {
    it('未ログインでも投稿に紐づくコメント一覧を取得できること', async () => {
      const response = await request(server)
        .get(`/microposts/${testPost.id}/comments`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.comments)).toBe(true);
      expect(response.body.comments.length).toBeGreaterThan(0);
      expect(response.body.comments[0].content).toBe('Test comment content');
      expect(response.body.comments[0].user.name).toBe('TestUser');
    });
  });

  afterAll(async () => {
    await testServer.cleanup();
  });
}); 