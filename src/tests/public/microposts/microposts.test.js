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

      // テスト投稿のタイトルがHTMLに含まれていることを確認
      expect(response.text).toContain('Test Post Title');
      
      // レスポンスが正しいHTMLフォーマットであることを確認
      expect(response.text).toContain('マイクロポスト一覧');
      expect(response.text).toContain('最新の投稿をチェックする');

      console.log('--- 投稿一覧取得テスト完了 ---\n');
    });
  });

  afterAll(async () => {
    await testServer.cleanup();
    console.log('=== テストクリーンアップ完了 ===');
  });
}); 