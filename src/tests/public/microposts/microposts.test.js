const { getTestServer } = require('../../test-setup');

describe('マイクロポスト統合テスト', () => {
  let testServer;
  let server;
  let testUser;
  let authCookie;
  let testPost;

  beforeAll(async () => {
    console.log('=== マイクロポストテストセットアップ開始 ===');
    testServer = await getTestServer();
    server = testServer.getServer();
    console.log('=== マイクロポストテストセットアップ完了 ===\n');
  });

  beforeEach(async () => {
    await testServer.database.clean();
    
    // テストユーザーとマイクロポストの作成
    const setup = await testServer.setupTestEnvironment({ 
      createUser: true,
      userData: {
        email: 'user@example.com',
        name: 'TestUser'
      }
    });
    testUser = setup.testUser;
    authCookie = setup.authCookie;

    // テスト用マイクロポストの作成
    testPost = await testServer.getPrisma().micropost.create({
      data: {
        title: 'Test Post Title',
        userId: testUser.id
      },
      include: {
        user: {
          include: {
            profile: true
          }
        }
      }
    });
  });

  describe('マイクロポスト一覧表示', () => {
    it('公開されているマイクロポストの一覧を取得できること', async () => {
      const response = await testServer
        .authenticatedRequest(authCookie)
        .get('/microposts');

      console.log('一覧表示レスポンス:', {
        status: response.status,
        body: response.body
      });

      // ステータスコードの検証のみ
      expect(response.status).toBe(200);
    });
  });

  afterAll(async () => {
    await testServer.cleanup();
  });
}); 