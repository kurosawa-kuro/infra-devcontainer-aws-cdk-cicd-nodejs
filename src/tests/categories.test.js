const request = require('supertest');
const { getTestServer } = require('./test-setup');

describe('Category Integration Tests', () => {
  const testServer = getTestServer();
  let server;
  let prisma;
  let testUser;
  let authCookie;
  let authRequest;

  beforeAll(async () => {
    server = testServer.getServer();
    prisma = testServer.getPrisma();
  });

  beforeEach(async () => {
    // Setup test environment with user and categories
    const result = await testServer.setupTestEnvironment({ 
      createUser: true,
      createCategories: true 
    });
    testUser = result.testUser;
    authCookie = result.authCookie;
    authRequest = testServer.authenticatedRequest(authCookie);
  });

  describe('カテゴリー一覧表示', () => {
    it('サイドバーに全てのカテゴリーが表示されること', async () => {
      const response = await request(server).get('/home');
      expect(response.status).toBe(200);

      // デフォルトカテゴリーの確認
      expect(response.text).toContain('プログラミング');
      expect(response.text).toContain('インフラ');
      expect(response.text).toContain('セキュリティ');
    });

    it('カテゴリーが投稿数と共に表示されること', async () => {
      // テスト投稿の作成
      const testMicropost = await prisma.micropost.create({
        data: {
          title: 'Test post with category',
          content: 'Test content',
          userId: testUser.id
        }
      });

      // プログラミングカテゴリーの取得
      const programmingCategory = await prisma.category.findFirst({
        where: { name: 'プログラミング' }
      });

      // 投稿とカテゴリーの関連付け
      await prisma.categoryMicropost.create({
        data: {
          micropostId: testMicropost.id,
          categoryId: programmingCategory.id
        }
      });

      const response = await request(server).get('/home');
      expect(response.status).toBe(200);

      // 投稿数の表示確認
      expect(response.text).toMatch(/プログラミング[\s\S]*?1/);
      expect(response.text).toMatch(/インフラ[\s\S]*?0/);
      expect(response.text).toMatch(/セキュリティ[\s\S]*?0/);
    });
  });
}); 