const request = require('supertest');
const { getTestServer } = require('../../test-setup');

describe('マイクロポストのコメント機能の統合テスト', () => {
  let testServer;
  let server;
  let testUser;
  let testPost;
  let testComment;

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

    // テスト用の投稿を作成
    testPost = await testServer.createTestMicropost(testUser.id, {
      title: 'Test Post',
      content: 'This is a test post content'
    });

    // テスト用のコメントを作成
    testComment = await testServer.prisma.comment.create({
      data: {
        content: 'Test comment content',
        userId: testUser.id,
        micropostId: testPost.id
      },
      include: {
        user: true,
        micropost: true
      }
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

    it('未ログインでもコメント詳細を取得できること', async () => {
      const response = await request(server)
        .get(`/microposts/${testPost.id}/comments/${testComment.id}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.comment).toBeTruthy();
      expect(response.body.comment.content).toBe('Test comment content');
      expect(response.body.comment.user.name).toBe('TestUser');
    });
  });

  afterAll(async () => {
    await testServer.cleanup();
  });
}); 