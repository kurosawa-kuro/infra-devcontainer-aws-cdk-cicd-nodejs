const { getTestServer } = require('../test-setup');

describe('通知機能の統合テスト', () => {
  let testServer;
  let server;
  let testUser;
  let authCookie;
  let testMicropost;
  let testNotification;

  beforeAll(async () => {
    console.log('=== 通知テストセットアップ開始 ===');
    testServer = await getTestServer();
    server = testServer.getServer();
    console.log('=== 通知テストセットアップ完了 ===\n');
  });

  beforeEach(async () => {
    console.log('\n=== テストケースセットアップ開始 ===');
    await testServer.database.clean();
    
    // テストユーザーの作成
    console.log('テストユーザー作成中...');
    const setup = await testServer.setupTestEnvironment({ 
      createUser: true,
      userData: {
        email: 'user@example.com',
        name: 'TestUser'
      }
    });
    testUser = setup.testUser;
    authCookie = setup.authCookie;

    console.log('作成されたテストユーザー:', {
      id: testUser.id,
      email: testUser.email,
      name: testUser.name
    });

    // テスト用の投稿を作成
    console.log('テスト投稿作成中...');
    testMicropost = await testServer.createTestMicropost(testUser.id, {
      title: 'Test Post for Notification',
      content: 'This is a test post for notification testing'
    });

    // テスト用の通知を作成
    console.log('テスト通知作成中...');
    testNotification = await testServer.getPrisma().notification.create({
      data: {
        type: 'LIKE',
        content: `Someone liked your post "${testMicropost.title}"`,
        isRead: false,
        userId: testUser.id,
        micropostId: testMicropost.id
      },
      include: {
        user: true,
        micropost: true
      }
    });

    console.log('作成された通知:', {
      id: testNotification.id,
      type: testNotification.type,
      content: testNotification.content,
      userId: testNotification.userId,
      micropostId: testNotification.micropostId,
      isRead: testNotification.isRead
    });
    console.log('=== テストケースセットアップ完了 ===\n');
  });

  describe('通知一覧表示', () => {
    it('ユーザーの通知一覧を取得できること', async () => {
      console.log('\n--- 通知一覧取得テスト開始 ---');
      console.log('リクエスト実行中...', {
        url: '/notifications',
        method: 'GET',
        authCookie: !!authCookie
      });

      // 実行前の通知数を確認
      const beforeCount = await testServer.getPrisma().notification.count({
        where: { userId: testUser.id }
      });
      console.log('テスト実行前の通知数:', beforeCount);

      const response = await testServer
        .authenticatedRequest(authCookie)
        .get('/notifications');

      console.log('通知一覧レスポンス:', {
        status: response.status,
        headers: response.headers,
        body: response.body
      });

      // 実行後の通知を確認
      const afterNotifications = await testServer.getPrisma().notification.findMany({
        where: { userId: testUser.id },
        include: { user: true, micropost: true }
      });
      console.log('テスト実行後の通知:', afterNotifications);

      // レスポンスの検証
      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(beforeCount);
      expect(response.body[0]).toMatchObject({
        id: testNotification.id,
        type: testNotification.type,
        content: testNotification.content,
        isRead: testNotification.isRead
      });
      console.log('--- 通知一覧取得テスト完了 ---\n');
    });
  });

  afterAll(async () => {
    await testServer.cleanup();
    console.log('=== テストクリーンアップ完了 ===');
  });
}); 