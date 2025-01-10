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
      name: testUser.name,
      roles: testUser.userRoles?.map(ur => ur.role.name)
    });

    // テスト用の投稿を作成
    console.log('テスト投稿作成中...');
    testMicropost = await testServer.createTestMicropost(testUser.id, {
      title: 'Test Post for Notification'
    });

    console.log('作成された投稿:', {
      id: testMicropost.id,
      title: testMicropost.title,
      userId: testMicropost.userId,
      createdAt: testMicropost.createdAt
    });

    // データベースの状態を確認
    console.log('\nデータベースの状態確認:');
    const userCount = await testServer.getPrisma().user.count();
    const postCount = await testServer.getPrisma().micropost.count();
    const notificationCount = await testServer.getPrisma().notification.count();
    console.log('現在のレコード数:', {
      users: userCount,
      posts: postCount,
      notifications: notificationCount
    });

    // テスト用の通知を作成
    console.log('\nテスト通知作成中...');
    testNotification = await testServer.getPrisma().notification.create({
      data: {
        type: 'LIKE',
        read: false,
        recipientId: testUser.id,
        actorId: testUser.id,
        micropostId: testMicropost.id
      },
      include: {
        recipient: true,
        actor: true,
        micropost: true
      }
    });

    console.log('作成された通知:', {
      id: testNotification.id,
      type: testNotification.type,
      recipientId: testNotification.recipientId,
      actorId: testNotification.actorId,
      micropostId: testNotification.micropostId,
      read: testNotification.read,
      createdAt: testNotification.createdAt
    });

    // 通知作成後のデータベース状態を確認
    const afterNotificationCount = await testServer.getPrisma().notification.count();
    console.log('通知作成後の通知数:', afterNotificationCount);
    console.log('=== テストケースセットアップ完了 ===\n');
  });

  describe('通知一覧表示', () => {
    it('ユーザーの通知一覧を取得できること', async () => {
      console.log('\n--- 通知一覧取得テスト開始 ---');
      
      // テスト実行前の通知を確認
      const beforeNotifications = await testServer.getPrisma().notification.findMany({
        where: { recipientId: testUser.id },
        include: { recipient: true, actor: true, micropost: true }
      });
      console.log('テスト実行前の通知一覧:', {
        count: beforeNotifications.length,
        notifications: beforeNotifications.map(n => ({
          id: n.id,
          type: n.type,
          recipientId: n.recipientId,
          actorId: n.actorId,
          micropostId: n.micropostId,
          read: n.read
        }))
      });

      console.log('リクエスト実行中...', {
        url: '/notifications',
        method: 'GET',
        authCookie: !!authCookie,
        userId: testUser.id
      });

      const response = await testServer
        .authenticatedRequest(authCookie)
        .get('/notifications');

      console.log('通知一覧レスポンス:', {
        status: response.status,
        headers: response.headers,
        contentType: response.headers['content-type']
      });

      // レスポンスの検証
      expect(response.status).toBe(200);
      expect(response.text).toContain('いいね');

      // テスト実行後の通知を確認
      const afterNotifications = await testServer.getPrisma().notification.findMany({
        where: { recipientId: testUser.id },
        include: { recipient: true, actor: true, micropost: true }
      });
      console.log('テスト実行後の通知一覧:', {
        count: afterNotifications.length,
        notifications: afterNotifications.map(n => ({
          id: n.id,
          type: n.type,
          recipientId: n.recipientId,
          actorId: n.actorId,
          micropostId: n.micropostId,
          read: n.read
        }))
      });
      console.log('--- 通知一覧取得テスト完了 ---\n');
    });
  });

  afterAll(async () => {
    await testServer.cleanup();
    console.log('=== テストクリーンアップ完了 ===');
  });
}); 