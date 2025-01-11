const request = require('supertest');
const { getTestServer } = require('../../test-setup');

describe('マイクロポストのいいね機能の統合テスト', () => {
  let testServer;
  let server;
  let testUser;
  let testPost;
  let testLike;

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

  afterAll(async () => {
    await testServer.cleanup();
  });
}); 