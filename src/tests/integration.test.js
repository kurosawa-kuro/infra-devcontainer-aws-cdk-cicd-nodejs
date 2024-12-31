const request = require('supertest');
const { Application } = require('../app');
const { PrismaClient } = require('@prisma/client');

describe('Authentication Integration Tests', () => {
  let app;
  let prisma;
  let server;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = new Application();
    await app.setupMiddleware();
    await app.setupRoutes();
    await app.setupErrorHandler();
    server = app.app;
    prisma = new PrismaClient();
  });

  beforeEach(async () => {
    // テストデータベースのクリーンアップ
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.cleanup();
  });

  describe('User Registration', () => {
    const testUser = {
      email: 'test@example.com',
      password: 'password123',
      passwordConfirmation: 'password123'
    };

    it('should successfully register a new user', async () => {
      const response = await request(server)
        .post('/auth/signup')
        .send(testUser)
        .expect(302); // リダイレクトを期待

      // リダイレクト先の確認
      expect(response.header.location).toBe('/auth/login');

      // データベースに保存されたことを確認
      const user = await prisma.user.findUnique({
        where: { email: testUser.email }
      });
      expect(user).toBeTruthy();
      expect(user.email).toBe(testUser.email);
    });

    // it('should not register a user with an existing email', async () => {
    //   // 最初のユーザーを登録
    //   await request(server)
    //     .post('/auth/signup')
    //     .send(testUser)
    //     .expect(302);

    //   // 同じメールアドレスで再度登録を試みる
    //   const response = await request(server)
    //     .post('/auth/signup')
    //     .send(testUser)
    //     .expect(302);

    //   // エラーメッセージのフラッシュを確認するために、リダイレクト先にアクセス
    //   const followUpResponse = await request(server)
    //     .get('/auth/signup')
    //     .expect(200);

    //   expect(followUpResponse.text).toContain('bg-red-50');
    //   expect(followUpResponse.text).toContain('このメールアドレスは既に登録されています');
    // });
  });

  describe('User Login', () => {
    const testUser = {
      email: 'test@example.com',
      password: 'password123'
    };

    beforeEach(async () => {
      // テストユーザーを作成
      await request(server)
        .post('/auth/signup')
        .send({
          ...testUser,
          passwordConfirmation: testUser.password
        });
    });

    it('should successfully login with correct credentials', async () => {
      const response = await request(server)
        .post('/auth/login')
        .send(testUser)
        .expect(302);

      expect(response.header.location).toBe('/');
    });

    // it('should fail to login with incorrect password', async () => {
    //   const response = await request(server)
    //     .post('/auth/login')
    //     .send({
    //       email: testUser.email,
    //       password: 'wrongpassword'
    //     })
    //     .expect(302);

    //   expect(response.header.location).toBe('/auth/login');

    //   // エラーメッセージを確認
    //   const followUpResponse = await request(server)
    //     .get('/auth/login')
    //     .expect(200);

    //   expect(followUpResponse.text).toContain('bg-red-50');
    //   expect(followUpResponse.text).toContain('パスワードが間違っています');
    // });

    // it('should fail to login with non-existent email', async () => {
    //   const response = await request(server)
    //     .post('/auth/login')
    //     .send({
    //       email: 'nonexistent@example.com',
    //       password: testUser.password
    //     })
    //     .expect(302);

    //   expect(response.header.location).toBe('/auth/login');

    //   // エラーメッセージを確認
    //   const followUpResponse = await request(server)
    //     .get('/auth/login')
    //     .expect(200);

    //   expect(followUpResponse.text).toContain('bg-red-50');
    //   expect(followUpResponse.text).toContain('ユーザーが見つかりません');
    // });
  });

  describe('User Logout', () => {
    const testUser = {
      email: 'test@example.com',
      password: 'password123'
    };

    beforeEach(async () => {
      // テストユーザーを作成してログイン
      await request(server)
        .post('/auth/signup')
        .send({
          ...testUser,
          passwordConfirmation: testUser.password
        });

      await request(server)
        .post('/auth/login')
        .send(testUser);
    });

    it('should successfully logout', async () => {
      const response = await request(server)
        .get('/auth/logout')
        .expect(302);

      expect(response.header.location).toBe('/auth/login');

      // ログアウト後に保護されたルートにアクセスできないことを確認
      const protectedResponse = await request(server)
        .get('/profile/1')
        .expect(302);

      expect(protectedResponse.header.location).toBe('/auth/login');
    });
  });
}); 