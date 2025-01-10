const request = require('supertest');
const { getTestServer, TEST_ADMIN } = require('./test-setup');

describe('Micropost Integration Tests', () => {
  const testServer = getTestServer();
  let server;
  let prisma;
  let testUser;
  let authCookie;
  let adminUser;
  let adminCookie;

  beforeAll(async () => {
    server = testServer.getServer();
    prisma = testServer.getPrisma();
  });

  beforeEach(async () => {
    // 一般ユーザーの作成とログイン
    const result = await testServer.createTestUserAndLogin();
    authCookie = result.authCookie;
    testUser = result.user;

    // 管理者ユーザーの作成とログイン
    const adminResult = await testServer.createTestUserAndLogin(TEST_ADMIN, true);
    adminCookie = adminResult.authCookie;
    adminUser = adminResult.user;
  });

  describe('投稿の作成機能', () => {
    it('タイトルのみの投稿を作成できること', async () => {
      const postTitle = 'Test Micropost Title';
      const response = await request(server)
        .post('/microposts')
        .set('Cookie', authCookie)
        .set('Accept', 'application/json')
        .send({ title: postTitle })
        .expect(302);

      const micropost = await prisma.micropost.findFirst({
        where: { title: postTitle }
      });
      expect(micropost).toBeTruthy();
      expect(micropost.title).toBe(postTitle);
      expect(micropost.userId).toBe(testUser.id);
    });

    it('画像付きの投稿を作成できること', async () => {
      const postTitle = 'Test Micropost with Image';
      const response = await request(server)
        .post('/microposts')
        .set('Cookie', authCookie)
        .set('Accept', 'application/json')
        .field('title', postTitle)
        .attach('image', 'src/tests/fixtures/test-image.jpg')
        .expect(302);

      const micropost = await prisma.micropost.findFirst({
        where: { title: postTitle }
      });
      expect(micropost).toBeTruthy();
      expect(micropost.imageUrl).toBeTruthy();
    });

    /* カテゴリー機能は後回し
    it('カテゴリー付きの投稿を作成できること', async () => {
      // カテゴリーの作成
      const category = await prisma.category.create({
        data: { name: 'Test Category' }
      });

      const postTitle = 'Test Micropost with Category';
      const response = await request(server)
        .post('/microposts')
        .set('Cookie', authCookie)
        .set('Accept', 'application/json')
        .send({ 
          title: postTitle,
          categories: [category.id]
        })
        .expect(302);

      const micropost = await prisma.micropost.findFirst({
        where: { title: postTitle },
        include: { categories: { include: { category: true } } }
      });
      expect(micropost).toBeTruthy();
      expect(micropost.categories[0].category.name).toBe('Test Category');
    });
    */

    it('未認証ユーザーは投稿を作成できないこと', async () => {
      await request(server)
        .post('/microposts')
        .send({ title: 'Unauthorized Post' })
        .expect(302)
        .expect('Location', '/auth/login');
    });
  });

  describe('投稿の表示機能', () => {
    let testMicropost;

    beforeEach(async () => {
      // テスト用の投稿を作成
      testMicropost = await prisma.micropost.create({
        data: {
          title: 'Test Micropost for Display',
          userId: testUser.id
        }
      });
    });

    it('投稿一覧を取得できること', async () => {
      const response = await request(server)
        .get('/microposts')
        .set('Cookie', authCookie)
        .expect(200);

      expect(response.text).toContain('Test Micropost for Display');
    });

    it('投稿詳細を表示できること', async () => {
      const response = await request(server)
        .get(`/microposts/${testMicropost.id}`)
        .set('Cookie', authCookie)
        .expect(200);

      expect(response.text).toContain('Test Micropost for Display');
    });

    it('ビューカウントが増加すること', async () => {
      const ipAddress = '127.0.0.1';
      await request(server)
        .get(`/microposts/${testMicropost.id}`)
        .set('Cookie', authCookie)
        .set('X-Forwarded-For', ipAddress)
        .expect(200);

      const views = await prisma.micropostView.count({
        where: { micropostId: testMicropost.id }
      });
      expect(views).toBe(1);
    });
  });

  describe('いいね機能', () => {
    let testMicropost;

    beforeEach(async () => {
      testMicropost = await prisma.micropost.create({
        data: {
          title: 'Test Micropost for Likes',
          userId: testUser.id
        }
      });
    });

    it('投稿にいいねできること', async () => {
      await request(server)
        .post(`/microposts/${testMicropost.id}/likes`)
        .set('Cookie', adminCookie)
        .expect(200);

      const likes = await prisma.like.count({
        where: { micropostId: testMicropost.id }
      });
      expect(likes).toBe(1);
    });

    it('いいねを取り消せること', async () => {
      // まずいいねを作成
      await prisma.like.create({
        data: {
          userId: adminUser.id,
          micropostId: testMicropost.id
        }
      });

      await request(server)
        .delete(`/microposts/${testMicropost.id}/likes`)
        .set('Cookie', adminCookie)
        .expect(200);

      const likes = await prisma.like.count({
        where: { micropostId: testMicropost.id }
      });
      expect(likes).toBe(0);
    });
  });

  describe('コメント機能', () => {
    let testMicropost;

    beforeEach(async () => {
      testMicropost = await prisma.micropost.create({
        data: {
          title: 'Test Micropost for Comments',
          userId: testUser.id
        }
      });
    });

    it('コメントを投稿できること', async () => {
      const commentContent = 'Test Comment';
      await request(server)
        .post(`/microposts/${testMicropost.id}/comments`)
        .set('Cookie', authCookie)
        .send({ content: commentContent })
        .expect(302);

      const comment = await prisma.comment.findFirst({
        where: { content: commentContent }
      });
      expect(comment).toBeTruthy();
      expect(comment.content).toBe(commentContent);
    });

    /* コメント削除機能は後回し
    it('コメントを削除できること', async () => {
      // まずコメントを作成
      const comment = await prisma.comment.create({
        data: {
          content: 'Comment to be deleted',
          userId: testUser.id,
          micropostId: testMicropost.id
        }
      });

      await request(server)
        .delete(`/microposts/${testMicropost.id}/comments/${comment.id}`)
        .set('Cookie', authCookie)
        .expect(302);

      const deletedComment = await prisma.comment.findUnique({
        where: { id: comment.id }
      });
      expect(deletedComment).toBeNull();
    });
    */
  });

  /* 投稿の削除機能は後回し
  describe('投稿の削除機能', () => {
    it('作成者は投稿を削除できること', async () => {
      const micropost = await prisma.micropost.create({
        data: {
          title: 'Micropost to be deleted',
          userId: testUser.id
        }
      });

      await request(server)
        .delete(`/microposts/${micropost.id}`)
        .set('Cookie', authCookie)
        .expect(302);

      const deletedMicropost = await prisma.micropost.findUnique({
        where: { id: micropost.id }
      });
      expect(deletedMicropost).toBeNull();
    });

    it('管理者は他人の投稿を削除できること', async () => {
      const micropost = await prisma.micropost.create({
        data: {
          title: 'Micropost to be deleted by admin',
          userId: testUser.id
        }
      });

      await request(server)
        .delete(`/microposts/${micropost.id}`)
        .set('Cookie', adminCookie)
        .expect(302);

      const deletedMicropost = await prisma.micropost.findUnique({
        where: { id: micropost.id }
      });
      expect(deletedMicropost).toBeNull();
    });

    it('一般ユーザーは他人の投稿を削除できないこと', async () => {
      const micropost = await prisma.micropost.create({
        data: {
          title: 'Micropost that should not be deleted',
          userId: adminUser.id
        }
      });

      await request(server)
        .delete(`/microposts/${micropost.id}`)
        .set('Cookie', authCookie)
        .expect(403);

      const existingMicropost = await prisma.micropost.findUnique({
        where: { id: micropost.id }
      });
      expect(existingMicropost).toBeTruthy();
    });
  });
  */
}); 