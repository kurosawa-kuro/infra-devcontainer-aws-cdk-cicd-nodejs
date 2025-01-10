const { getTestServer } = require('../../test-setup');
const request = require('supertest');

describe('投稿機能の統合テスト', () => {
  let testServer;
  let server;
  let testUser;
  let authCookie;
  let testMicropost;

  beforeAll(async () => {
    console.log('=== 投稿テストセットアップ開始 ===');
    testServer = await getTestServer();
    server = testServer.getServer();
    console.log('=== 投稿テストセットアップ完了 ===\n');
  });

  beforeEach(async () => {
    console.log('\n=== テストケースセットアップ開始 ===');
    await testServer.database.clean();
    
    // テストユーザーの作成
    console.log('テストユーザー作成中...');
    const setup = await testServer.setupTestEnvironment({ 
      createUser: true,
      userData: {
        email: 'user@example.com',
        name: 'TestUser'
      }
    });
    testUser = setup.testUser;
    authCookie = setup.authCookie;

    console.log('作成されたテストユーザー:', {
      id: testUser.id,
      email: testUser.email,
      name: testUser.name
    });

    // テスト用の投稿を作成
    console.log('テスト投稿作成中...');
    testMicropost = await testServer.createTestMicropost(testUser.id, {
      title: 'Test Post Title'
    });

    console.log('=== テストケースセットアップ完了 ===\n');
  });

  describe('投稿一覧表示', () => {
    it('投稿一覧を取得できること', async () => {
      console.log('\n--- 投稿一覧取得テスト開始 ---');
      console.log('リクエスト実行中...', {
        url: '/microposts',
        method: 'GET'
      });

      const response = await request(server)
        .get('/microposts');

      console.log('投稿一覧レスポンス:', {
        status: response.status,
        headers: response.headers
      });

      // レスポンスの検証
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/text\/html/);
      expect(response.text).toContain('Test Post Title');
      console.log('--- 投稿一覧取得テスト完了 ---\n');
    });
  });

  afterAll(async () => {
    await testServer.cleanup();
    console.log('=== テストクリーンアップ完了 ===');
  });
}); 