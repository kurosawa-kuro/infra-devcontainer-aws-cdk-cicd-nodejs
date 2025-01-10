const request = require('supertest');
const { getTestServer } = require('./test-setup');

describe('認証統合テスト', () => {
  let testServer;
  let server;

  beforeAll(async () => {
    console.log('=== 認証テストセットアップ開始 ===');
    testServer = await getTestServer();
    server = testServer.getServer();
    console.log('=== 認証テストセットアップ完了 ===\n');
  });

  beforeEach(async () => {
    await testServer.database.clean();
  });

  describe('ユーザー登録', () => {
    it('新規ユーザーを正常に登録できること', async () => {
      // テストデータ準備
      const userData = {
        email: 'newuser@example.com',
        password: 'password123',
        name: 'NewUser',
        terms: 'on',
        _csrf: 'test-csrf-token'
      };

      // 登録リクエスト実行
      const response = await request(server)
        .post('/auth/signup')
        .send(userData);

      // レスポンス検証
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/');

      // データベース検証
      const createdUser = await testServer.getPrisma().user.findUnique({
        where: { email: userData.email },
        include: {
          profile: true,
          userRoles: {
            include: { role: true }
          }
        }
      });

      expect(createdUser).toBeTruthy();
      expect(createdUser.email).toBe(userData.email);
      expect(createdUser.profile).toBeTruthy();
      expect(createdUser.userRoles).toHaveLength(1);
      expect(createdUser.userRoles[0].role.name).toBe('user');
    });
  });

  describe('ユーザーログイン', () => {
    describe('一般ユーザーログイン', () => {
      let testUser;
      let authCookie;

      beforeEach(async () => {
        const setup = await testServer.setupTestEnvironment({ 
          createUser: true,
          userData: {
            email: 'user@example.com',
            name: 'TestUser'
          }
        });
        testUser = setup.testUser;
        authCookie = setup.authCookie;
      });

      it('正しい認証情報でログインできること', async () => {
        // セッション情報の検証
        const sessionResponse = await testServer
          .authenticatedRequest(authCookie)
          .get('/auth/session');

        expect(sessionResponse.status).toBe(200);
        expect(sessionResponse.body.user).toBeTruthy();
        expect(sessionResponse.body.user.email).toBe(testUser.email);
      });
    });

    describe('管理者ユーザーログイン', () => {
      let adminUser;
      let authCookie;

      beforeEach(async () => {
        const setup = await testServer.setupTestEnvironment({ 
          createUser: true,
          userData: {
            email: 'admin@example.com',
            name: 'AdminUser',
            roles: ['admin', 'user']
          }
        });
        adminUser = setup.testUser;
        authCookie = setup.authCookie;
      });

      it('管理者権限でログインできること', async () => {
        // セッション情報の検証
        const sessionResponse = await testServer
          .authenticatedRequest(authCookie)
          .get('/auth/session');

        expect(sessionResponse.status).toBe(200);
        expect(sessionResponse.body.user).toBeTruthy();
        expect(sessionResponse.body.user.email).toBe(adminUser.email);
        expect(sessionResponse.body.user.roles).toContain('admin');
      });
    });
  });

  afterAll(async () => {
    await testServer.cleanup();
  });
}); 