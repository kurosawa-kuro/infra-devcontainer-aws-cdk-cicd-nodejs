const request = require('supertest');
const { getTestServer, TEST_ADMIN } = require('./test-setup');

describe('User Profile Integration Tests', () => {
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

  describe('プロフィール表示機能', () => {
    it('IDでプロフィールを表示できること', async () => {
      const response = await request(server)
        .get(`/profile/${testUser.id}`)
        .set('Cookie', authCookie)
        .expect(200);

      expect(response.text).toContain(testUser.name);
      expect(response.text).toContain(testUser.email);
    });

    it('ユーザー名でプロフィールを表示できること', async () => {
      const response = await request(server)
        .get(`/profile/${testUser.name}`)
        .set('Cookie', authCookie)
        .expect(200);

      expect(response.text).toContain(testUser.name);
      expect(response.text).toContain(testUser.email);
    });

    it('存在しないユーザーのプロフィールにアクセスすると404エラーになること', async () => {
      await request(server)
        .get('/profile/999999')
        .set('Cookie', authCookie)
        .expect(404);
    });
  });

  describe('プロフィール編集機能', () => {
    it('自分のプロフィール編集ページを表示できること', async () => {
      const response = await request(server)
        .get(`/profile/${testUser.id}/edit`)
        .set('Cookie', authCookie)
        .expect(200);

      expect(response.text).toContain('プロフィール編集');
      expect(response.text).toContain(testUser.name);
    });

    it('他人のプロフィール編集ページにアクセスすると403エラーになること', async () => {
      await request(server)
        .get(`/profile/${adminUser.id}/edit`)
        .set('Cookie', authCookie)
        .expect(403);
    });

    it('プロフィール情報を更新できること', async () => {
      const updatedName = 'Updated Name';
      const response = await request(server)
        .post(`/profile/${testUser.id}/edit`)
        .set('Cookie', authCookie)
        .send({ name: updatedName })
        .expect(302);

      const updatedUser = await prisma.user.findUnique({
        where: { id: testUser.id }
      });
      expect(updatedUser.name).toBe(updatedName);
    });

    it('管理者は他人のプロフィールを編集できること', async () => {
      const updatedName = 'Admin Updated Name';
      await request(server)
        .post(`/profile/${testUser.id}/edit`)
        .set('Cookie', adminCookie)
        .send({ name: updatedName })
        .expect(302);

      const updatedUser = await prisma.user.findUnique({
        where: { id: testUser.id }
      });
      expect(updatedUser.name).toBe(updatedName);
    });
  });

  describe('フォロー機能', () => {
    it('ユーザーをフォローできること', async () => {
      await request(server)
        .post(`/users/${adminUser.id}/followers`)
        .set('Cookie', authCookie)
        .expect(200);

      const follows = await prisma.follow.findFirst({
        where: {
          followerId: testUser.id,
          followingId: adminUser.id
        }
      });
      expect(follows).toBeTruthy();
    });

    it('フォローを解除できること', async () => {
      // まずフォローを作成
      await prisma.follow.create({
        data: {
          followerId: testUser.id,
          followingId: adminUser.id
        }
      });

      await request(server)
        .delete(`/users/${adminUser.id}/followers`)
        .set('Cookie', authCookie)
        .expect(200);

      const follows = await prisma.follow.findFirst({
        where: {
          followerId: testUser.id,
          followingId: adminUser.id
        }
      });
      expect(follows).toBeNull();
    });

    it('フォロー中のユーザー一覧を表示できること', async () => {
      // フォローを作成
      await prisma.follow.create({
        data: {
          followerId: testUser.id,
          followingId: adminUser.id
        }
      });

      const response = await request(server)
        .get(`/users/${testUser.id}/following`)
        .set('Cookie', authCookie)
        .expect(200);

      expect(response.text).toContain(adminUser.name);
    });

    it('フォロワー一覧を表示できること', async () => {
      // フォローを作成
      await prisma.follow.create({
        data: {
          followerId: adminUser.id,
          followingId: testUser.id
        }
      });

      const response = await request(server)
        .get(`/users/${testUser.id}/followers`)
        .set('Cookie', authCookie)
        .expect(200);

      expect(response.text).toContain(adminUser.name);
    });

    it('自分自身をフォローできないこと', async () => {
      await request(server)
        .post(`/users/${testUser.id}/followers`)
        .set('Cookie', authCookie)
        .expect(400);

      const follows = await prisma.follow.findFirst({
        where: {
          followerId: testUser.id,
          followingId: testUser.id
        }
      });
      expect(follows).toBeNull();
    });
  });
}); 