const request = require('supertest');
const { getTestServer } = require('./test-setup');

describe('Micropost Integration Tests', () => {
  const testServer = getTestServer();
  let server;
  let prisma;
  let testUser;
  let testPost;

  beforeAll(async () => {
    server = testServer.getServer();
    prisma = testServer.getPrisma();
  });

  beforeEach(async () => {
    // テストユーザーの作成
    console.log('Creating test user...');
    const { user, response } = await testServer.createTestUser();
    console.log('Test user creation response:', response.status);
    testUser = user;
    console.log('Test user:', testUser);

    if (!testUser || !testUser.id) {
      console.error('Test user was not created properly');
      throw new Error('Test user creation failed');
    }

    // テスト用の投稿を作成
    console.log('Creating test post...');
    testPost = await prisma.micropost.create({
      data: {
        title: 'Test Post',
        userId: testUser.id
      }
    });
    console.log('Test post created:', testPost);
  });

  describe('投稿の表示機能', () => {
    it('未ログインでも投稿一覧を取得できること', async () => {
      console.log('Running test: 未ログインでも投稿一覧を取得できること');
      const response = await request(server)
        .get('/microposts')
        .expect(200);

      console.log('Response status:', response.status);
      console.log('Response body:', response.text);
      expect(response.text).toContain('Test Post');
    });
  });
}); 