const request = require('supertest');
const { getTestServer, TEST_ADMIN } = require('./test-setup');

describe('User Profile Integration Tests', () => {
  const testServer = getTestServer();
  let server;
  let prisma;
  let testUser;

  beforeAll(async () => {
    server = testServer.getServer();
    prisma = testServer.getPrisma();
  });

  beforeEach(async () => {
    // テストユーザーの作成（ログインは不要）
    const { user } = await testServer.createTestUser();
    testUser = user;
  });

  describe('プロフィール表示機能', () => {
    it('ユーザー名でプロフィールを表示できること', async () => {
      const response = await request(server)
        .get(`/profile/${testUser.name}`)
        .expect(200);

      expect(response.text).toContain(testUser.name);
      expect(response.text).toContain(testUser.email);
    });

    // it('プロフィールページにフォロー数とフォロワー数が表示されること', async () => {
    //   const response = await request(server)
    //     .get(`/profile/${testUser.name}`)
    //     .expect(200);

    //   expect(response.text).toContain('フォロー中');
    //   expect(response.text).toContain('フォロワー');
    // });

    // it('プロフィールページにユーザーの投稿一覧が表示されること', async () => {
    //   const response = await request(server)
    //     .get(`/profile/${testUser.name}`)
    //     .expect(200);

    //   expect(response.text).toContain('投稿一覧');
    // });
  });
}); 