const request = require('supertest');
const { getTestServer } = require('../../test-setup');

describe('マイクロポストのコメント機能の統合テスト', () => {
  let testServer;
  let server;
  let testUser;
  let testPost;
  let testComment;
  let authCookie;

  beforeAll(async () => {
    testServer = await getTestServer();
    server = testServer.getServer();
  });

  beforeEach(async () => {
    await testServer.database.clean();
    const setup = await testServer.setupTestEnvironment({ createUser: true });
    testUser = setup.testUser;
    authCookie = setup.authCookie;

    // テスト用のマイクロポストを作成
    testPost = await testServer.createTestMicropost(testUser.id);
    // テスト用のコメントを作成
    testComment = await testServer.createTestComment(testUser.id, testPost.id);
  });

  describe('コメント一覧表示', () => {
    it('未ログインでもコメント一覧を取得できること', async () => {
      const response = await request(server)
        .get(`/microposts/${testPost.id}/comments`);

      console.log('=== Comment List Test Debug ===');
      console.log('Response Status:', response.status);
      console.log('Response Body:', JSON.stringify(response.body, null, 2));
      console.log('Test User:', {
        id: testUser.id,
        name: testUser.name
      });
      console.log('Test Comment:', {
        id: testComment.id,
        content: testComment.content,
        userId: testComment.userId
      });
      console.log('================================');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.comments).toBeTruthy();
      expect(response.body.comments).toHaveLength(1);
      expect(response.body.comments[0].content).toBe('Test comment content');
      expect(response.body.comments[0].user.name).toBe('TestUser');
    });
  });

  afterAll(async () => {
    await testServer.cleanup();
  });
}); 