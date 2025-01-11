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

  describe('マイクロポストのいいね機能', () => {
    it('未ログインでも投稿一覧でいいね情報を取得できること', async () => {
      const response = await request(server)
        .get('/microposts')
        .set('Accept', 'application/json')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.microposts)).toBe(true);
      
      const testPostResponse = response.body.microposts.find(post => post.id === testPost.id);
      expect(testPostResponse).toBeDefined();
      expect(testPostResponse).toHaveProperty('_count.likes');
      expect(testPostResponse._count.likes).toBe(1);
    });
  });

  afterAll(async () => {
    await testServer.cleanup();
  });
}); 