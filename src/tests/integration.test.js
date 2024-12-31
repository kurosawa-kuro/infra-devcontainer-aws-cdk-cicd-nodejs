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

describe('Micropost Integration Tests', () => {
  let app;
  let prisma;
  let server;
  let testUser;
  let authCookie;

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
    // Clean up test database
    await prisma.micropost.deleteMany();
    await prisma.user.deleteMany();

    // Create test user
    const userResponse = await request(server)
      .post('/auth/signup')
      .send({
        email: 'test@example.com',
        password: 'password123',
        passwordConfirmation: 'password123'
      });

    // Login test user
    const loginResponse = await request(server)
      .post('/auth/login')
      .send({
        email: 'test@example.com',
        password: 'password123'
      });

    // Store auth cookie for subsequent requests
    authCookie = loginResponse.headers['set-cookie'];

    // Get test user
    testUser = await prisma.user.findUnique({
      where: { email: 'test@example.com' }
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.cleanup();
  });

  describe('Create Micropost', () => {
    it('should successfully create a new micropost', async () => {
      const postTitle = 'This is a test micropost';
      const response = await request(server)
        .post('/microposts')
        .set('Cookie', authCookie)
        .send({ title: postTitle })
        .expect(302);

      expect(response.header.location).toBe('/microposts');

      // Verify micropost was saved to database
      const micropost = await prisma.micropost.findFirst({
        where: { title: postTitle }
      });
      expect(micropost).toBeTruthy();
      expect(micropost.title).toBe(postTitle);
      expect(micropost.userId).toBe(testUser.id);
    });

    it('should successfully create a new micropost with image', async () => {
      const postTitle = 'This is a test micropost with image';
      const response = await request(server)
        .post('/microposts')
        .set('Cookie', authCookie)
        .field('title', postTitle)
        .attach('image', 'src/tests/fixtures/test-image.jpg')
        .expect(302);

      expect(response.header.location).toBe('/microposts');

      // Verify micropost was saved to database
      const micropost = await prisma.micropost.findFirst({
        where: { title: postTitle }
      });
      expect(micropost).toBeTruthy();
      expect(micropost.title).toBe(postTitle);
      expect(micropost.userId).toBe(testUser.id);
      expect(micropost.imageUrl).toBeTruthy();
      expect(micropost.imageUrl).toMatch(/^uploads\//); // ローカルストレージの場合のパスチェック
    });

    it('should not create micropost without authentication', async () => {
      const response = await request(server)
        .post('/microposts')
        .send({ title: 'Unauthorized post' })
        .expect(302);

      expect(response.header.location).toBe('/auth/login');
    });
  });

  describe('Read Microposts', () => {
    beforeEach(async () => {
      // Create test microposts
      await prisma.micropost.createMany({
        data: [
          { title: 'First post', userId: testUser.id },
          { title: 'Second post', userId: testUser.id }
        ]
      });
    });

    it('should list all microposts on home page', async () => {
      const response = await request(server)
        .get('/microposts')
        .set('Cookie', authCookie)
        .expect(200);

      expect(response.text).toContain('First post');
      expect(response.text).toContain('Second post');
    });
  });
}); 