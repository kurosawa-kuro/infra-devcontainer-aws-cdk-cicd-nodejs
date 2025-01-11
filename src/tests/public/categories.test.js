const request = require('supertest');
const { getTestServer } = require('../test-setup');

describe('カテゴリー機能の統合テスト', () => {
  let testServer;
  let server;
  let testUser;
  let testCategory;

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

    // テスト用のカテゴリーを作成
    testCategory = await testServer.prisma.category.create({
      data: {
        name: 'Test Category',
        description: 'Test category description'
      }
    });
  });

  describe('カテゴリーの表示機能', () => {
    it('未ログインでもカテゴリー一覧を取得できること', async () => {
      const response = await request(server)
        .get('/categories');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.categories)).toBe(true);
      expect(response.body.categories.length).toBeGreaterThan(0);
      expect(response.body.categories[0].name).toBe('Test Category');
      expect(response.body.categories[0].description).toBe('Test category description');
    });

    it('未ログインでもカテゴリー詳細を取得できること', async () => {
      const response = await request(server)
        .get(`/categories/${testCategory.id}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.category).toBeTruthy();
      expect(response.body.category.name).toBe('Test Category');
      expect(response.body.category.description).toBe('Test category description');
    });
  });

  afterAll(async () => {
    await testServer.cleanup();
  });
}); 