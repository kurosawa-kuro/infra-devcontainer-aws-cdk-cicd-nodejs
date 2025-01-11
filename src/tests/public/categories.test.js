const request = require('supertest');
const { getTestServer } = require('../test-setup');

describe('カテゴリー機能の統合テスト', () => {
  let testServer;
  let server;
  let testCategory;

  beforeAll(async () => {
    testServer = await getTestServer();
    server = testServer.getServer();
  });

  beforeEach(async () => {
    await testServer.database.clean();
    testCategory = await testServer.prisma.category.create({
      data: {
        name: 'Test Category'
      }
    });
  });

  describe('カテゴリー一覧表示', () => {
    it('未ログインでもレイアウトにカテゴリー情報が表示されること', async () => {
      const response = await request(server)
        .get('/microposts')
        .set('Accept', 'text/html')
        .expect(200);

      // HTMLレスポンスにカテゴリー情報が含まれていることを確認
      expect(response.text).toContain('Test Category');
      expect(response.text).toContain('カテゴリー');
    });
  });

  afterAll(async () => {
    await testServer.cleanup();
  });
}); 