const request = require('supertest');
const { getTestServer } = require('../../test-setup');

describe('コメント機能の統合テスト', () => {
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
        title: 'Test post for comments',
        content: 'This is a test post content',
        userId: testUser.id
      }
    });

    // テストコメントの作成
    await testServer.prisma.comment.create({
      data: {
        content: 'Test comment',
        userId: testUser.id,
        micropostId: testMicropost.id
      }
    });
  });

  describe('コメント表示', () => {
    it('投稿のコメント一覧を取得できること', async () => {
      const response = await request(server)
        .get(`/microposts/${testMicropost.id}/comments`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.comments)).toBe(true);
      expect(response.body.comments.length).toBe(1);
      expect(response.body.comments[0].content).toBe('Test comment');
    });
  });

  afterAll(async () => {
    await testServer.cleanup();
  });
}); 