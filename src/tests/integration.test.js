const request = require('supertest');
const { getTestServer } = require('./setup');

const testServer = getTestServer();

describe('Application Integration Tests', () => {
  // ヘルスチェックのテスト
  describe('Health Checks', () => {
    it('APIヘルスチェックが正常に動作すること', async () => {
      const res = await request(testServer.baseUrl)
        .get('/health')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(res.body).toEqual({ status: 'healthy' });
    });

    it('DBヘルスチェックが正常に動作すること', async () => {
      const res = await request(testServer.baseUrl)
        .get('/health-db')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(res.body).toEqual({ status: 'healthy' });
    });
  });

  // 投稿機能のテスト
  describe('Microposts CRUD', () => {
    it('初期状態で投稿一覧が空であること', async () => {
      const res = await request(testServer.baseUrl)
        .get('/')
        .expect('Content-Type', /html/)
        .expect(200);

      expect(res.text).toContain('投稿一覧');
      expect(res.text).toMatch(/<ul class="posts">\s*<\/ul>/);
    });

    it('新規投稿が作成できること', async () => {
      // 投稿の作成
      const title = 'テスト投稿';
      await request(testServer.baseUrl)
        .post('/microposts')
        .field('title', title)
        .expect(302);

      // データベースの確認
      const post = await testServer.prisma.micropost.findFirst({
        where: { title }
      });
      expect(post).toBeTruthy();
      expect(post.title).toBe(title);
      expect(post.imageUrl).toBeNull();

      // 作成した投稿が表示されることを確認
      const res = await request(testServer.baseUrl)
        .get('/')
        .expect(200);
      expect(res.text).toContain(title);
    });

    it('空の投稿がエラーになること', async () => {
      const res = await request(testServer.baseUrl)
        .post('/microposts')
        .field('title', '')
        .expect('Content-Type', /json/)
        .expect(400);

      expect(res.body.error).toBe('投稿内容を入力してください');
    });
  });
}); 