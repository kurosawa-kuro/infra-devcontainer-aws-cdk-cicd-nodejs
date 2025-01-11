const { getTestServer } = require('../../test-setup');
const request = require('supertest');

describe('投稿機能の統合テスト', () => {
  let testServer;
  let server;
  let testUser;
  let testPost;

  beforeAll(async () => {
    console.log('=== 投稿テストセットアップ開始 ===');
    testServer = await getTestServer();
    server = testServer.getServer();
    console.log('=== 投稿テストセットアップ完了 ===');
  });

  beforeEach(async () => {
    console.log('\n=== テストケースセットアップ開始 ===');
    await testServer.database.clean();
    console.log('テストユーザー作成中...');
    const setup = await testServer.setupTestEnvironment({ createUser: true });
    testUser = setup.testUser;
    console.log('作成されたテストユーザー:', {
      id: testUser.id,
      email: testUser.email,
      name: testUser.name
    });

    console.log('テスト投稿作成中...');
    testPost = await testServer.createTestMicropost(testUser.id, {
      title: 'Test Post Title'
    });
    console.log('=== テストケースセットアップ完了 ===');
  });

  describe('投稿一覧表示', () => {
    it('投稿一覧を取得できること', async () => {
      console.log('\n--- 投稿一覧取得テスト開始 ---');
      console.log('リクエスト実行中...', { url: '/microposts', method: 'GET' });
      const response = await request(server)
        .get('/microposts')
        .expect(200)
        .expect('Content-Type', /html/);

      console.log('投稿一覧レスポンス:', {
        status: response.status,
        headers: response.headers
      });

      // data-microposts属性から投稿データを取得して検証
      const micropostsData = response.text.match(/data-microposts="([^"]*)"/);
      expect(micropostsData).toBeTruthy();
      
      const decodedData = decodeURIComponent(micropostsData[1]);
      const microposts = JSON.parse(decodedData);
      
      expect(Array.isArray(microposts)).toBe(true);
      expect(microposts.length).toBeGreaterThan(0);
      
      const foundPost = microposts.find(post => post.title === 'Test Post Title');
      expect(foundPost).toBeTruthy();
      expect(foundPost.title).toBe('Test Post Title');

      console.log('--- 投稿一覧取得テスト完了 ---\n');
    });
  });

  afterAll(async () => {
    await testServer.cleanup();
    console.log('=== テストクリーンアップ完了 ===');
  });
}); 