const request = require('supertest');
const { getTestServer } = require('../../test-setup');

describe('いいね機能の統合テスト', () => {
  let testServer;
  let server;
  let testUser;
  let testMicropost;

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

    // テスト投稿の作成
    testMicropost = await testServer.prisma.micropost.create({
      data: {
        title: 'いいねテスト用の投稿',
        content: 'This is a test post content',
        userId: testUser.id
      }
    });

    // テストいいねの作成
    await testServer.prisma.like.create({
      data: {
        userId: testUser.id,
        micropostId: testMicropost.id
      }
    });
  });

  describe('いいね表示', () => {
    it('投稿のいいね数を取得できること', async () => {
      const response = await request(server)
        .get(`/microposts/${testMicropost.id}/likes/count`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.count).toBe(1);
    });

    it('投稿のいいねしたユーザー一覧を取得できること', async () => {
      const response = await request(server)
        .get(`/microposts/${testMicropost.id}/likes`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.users)).toBe(true);
      expect(response.body.users.length).toBe(1);
      expect(response.body.users[0].id).toBe(testUser.id);
    });
  });

  afterAll(async () => {
    await testServer.cleanup();
  });
}); 