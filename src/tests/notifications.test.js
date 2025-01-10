const request = require('supertest');
const { getTestServer } = require('./test-setup');

describe('お知らせ機能の統合テスト', () => {
  const testServer = getTestServer();
  let server;
  let prisma;
  let testUser;
  let authCookie;
  let testMicropost;
  let authRequest;

  beforeAll(async () => {
    console.log('=== Test Setup Start ===');
    try {
      server = testServer.getServer();
      prisma = testServer.getPrisma();
      console.log('Server and Prisma initialized successfully');
    } catch (error) {
      console.error('Failed to initialize server:', error);
      throw error;
    }
  });

  beforeEach(async () => {
    console.log('\n=== Test Case Setup Start ===');
    try {
      // テストユーザーのセットアップ
      console.log('Setting up test user...');
      const result = await testServer.setupTestEnvironment({ createUser: true });
      testUser = result.testUser;
      console.log('Test user created:', {
        userId: testUser.id,
        name: testUser.name,
        email: testUser.email
      });

      // 認証情報の確認
      authCookie = result.authCookie;
      console.log('Auth cookie received:', !!authCookie);
      authRequest = testServer.authenticatedRequest(authCookie);

      // テスト投稿の作成
      console.log('Creating test micropost...');
      testMicropost = await prisma.micropost.create({
        data: {
          title: 'お知らせテスト用の投稿',
          userId: testUser.id
        }
      });
      console.log('Test micropost created:', {
        id: testMicropost.id,
        title: testMicropost.title,
        userId: testMicropost.userId
      });

      // 投稿の作成を確認
      const createdPost = await prisma.micropost.findUnique({
        where: { id: testMicropost.id },
        include: { user: true }
      });
      console.log('Verified created post:', {
        found: !!createdPost,
        title: createdPost?.title,
        userName: createdPost?.user?.name
      });
    } catch (error) {
      console.error('Setup failed:', {
        phase: 'beforeEach',
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
    console.log('=== Test Case Setup Complete ===\n');
  });

  describe('お知らせ表示のテスト', () => {
    it('お知らせがない場合、適切なメッセージが表示されること', async () => {
      console.log('\n--- Testing: No notifications scenario ---');
      try {
        // 既存のお知らせがないことを確認
        const existingNotifications = await prisma.notification.findMany({
          where: { 
            recipientId: testUser.id 
          }
        });
        console.log('Existing notifications:', {
          count: existingNotifications.length,
          notifications: existingNotifications
        });

        // ログイン状態でお知らせページにアクセス
        console.log('Fetching notifications page with auth...');
        const response = await authRequest
          .get('/notifications')
          .set('Cookie', authCookie);

        console.log('Response received:', {
          status: response.status,
          headers: response.headers,
          contentType: response.type
        });

        // レスポンスの内容を詳細に確認
        const responseText = response.text;
        console.log('Response content check:', {
          hasEmptyMessage: responseText.includes('お知らせはありません'),
          contentLength: responseText.length,
          snippet: responseText.substring(0, 200)
        });

        expect(response.status).toBe(200);
        expect(responseText).toContain('お知らせはありません');
      } catch (error) {
        console.error('Test failed:', {
          scenario: 'No notifications',
          error: error.message,
          stack: error.stack
        });
        throw error;
      }
    });

    it('お知らせが表示されること', async () => {
      console.log('\n--- Testing: Notification display scenario ---');
      try {
        // 別のユーザーを作成
        console.log('Creating another test user...');
        const otherUser = await testServer.createOtherTestUser();
        console.log('Other user created:', {
          id: otherUser.id,
          name: otherUser.name,
          email: otherUser.email
        });

        // お知らせを作成
        console.log('Creating test notification...');
        const notification = await prisma.notification.create({
          data: {
            type: 'LIKE',
            read: false,
            recipient: {
              connect: { id: testUser.id }
            },
            actor: {
              connect: { id: otherUser.id }
            },
            micropost: {
              connect: { id: testMicropost.id }
            }
          }
        });
        console.log('Notification created:', {
          id: notification.id,
          type: notification.type,
          recipientId: notification.recipientId
        });

        // お知らせの作成を詳細に確認
        const createdNotification = await prisma.notification.findUnique({
          where: { id: notification.id },
          include: {
            recipient: true,
            actor: true,
            micropost: true
          }
        });
        console.log('Verified notification:', {
          found: !!createdNotification,
          type: createdNotification?.type,
          recipientName: createdNotification?.recipient?.name,
          actorName: createdNotification?.actor?.name,
          micropostTitle: createdNotification?.micropost?.title
        });

        // ログイン状態でお知らせページを取得
        console.log('Fetching notifications page with auth...');
        const response = await authRequest
          .get('/notifications')
          .set('Cookie', authCookie);

        console.log('Response received:', {
          status: response.status,
          headers: response.headers,
          contentType: response.type
        });

        // レスポンスの内容を詳細に確認
        const responseText = response.text;
        console.log('Response content check:', {
          hasActorName: responseText.includes(otherUser.name),
          hasLikeAction: responseText.includes('いいねしました'),
          contentLength: responseText.length,
          snippet: responseText.substring(0, 200)
        });

        expect(response.status).toBe(200);
        expect(responseText).toContain(otherUser.name);
        expect(responseText).toContain('いいねしました');
        expect(responseText).not.toContain('お知らせはありません');
      } catch (error) {
        console.error('Test failed:', {
          scenario: 'Notification display',
          error: error.message,
          stack: error.stack
        });
        throw error;
      }
    });
  });

  afterEach(async () => {
    console.log('\n=== Cleanup Start ===');
    try {
      // クリーンアップ前の状態を確認
      const notificationsBeforeCleanup = await prisma.notification.count({
        where: { micropostId: testMicropost?.id }
      });
      console.log('Before cleanup:', {
        notifications: notificationsBeforeCleanup
      });

      if (testMicropost?.id) {
        await prisma.notification.deleteMany({
          where: { micropostId: testMicropost.id }
        });
        await prisma.micropost.delete({
          where: { id: testMicropost.id }
        });
      }

      // クリーンアップ後の状態を確認
      const notificationsAfterCleanup = await prisma.notification.count({
        where: { micropostId: testMicropost?.id }
      });
      console.log('After cleanup:', {
        notifications: notificationsAfterCleanup
      });

      console.log('Cleanup completed successfully');
    } catch (error) {
      console.error('Cleanup failed:', {
        error: error.message,
        code: error.code,
        meta: error.meta,
        stack: error.stack
      });
    }
    console.log('=== Cleanup Complete ===\n');
  });
}); 