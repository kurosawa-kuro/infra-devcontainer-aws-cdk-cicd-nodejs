const request = require('supertest');
const { getTestServer } = require('../../test-setup');

describe('マイクロポストのいいね機能の統合テスト', () => {
  let testServer;
  let server;
  let testUser;
  let testPost;
  let testLike;
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

    // テスト用の投稿を作成
    testPost = await testServer.createTestMicropost(testUser.id, {
      title: 'Test Post'
    });

    // テスト用のいいねを作成
    testLike = await testServer.prisma.like.create({
      data: {
        userId: testUser.id,
        micropostId: testPost.id
      },
      include: {
        user: true,
        micropost: true
      }
    });
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