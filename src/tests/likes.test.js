const request = require('supertest');
const { getTestServer } = require('./test-setup');

describe('いいね機能の統合テスト', () => {
  const testServer = getTestServer();
  let server;
  let prisma;
  let testUser;
  let authCookie;
  let testMicropost;
  let authRequest;

  beforeAll(async () => {
    console.log('=== Test Setup Start ===');
    server = testServer.getServer();
    prisma = testServer.getPrisma();
    console.log('Server and Prisma initialized');
  });

  beforeEach(async () => {
    console.log('\n--- Test Case Setup Start ---');
    // テストユーザーのセットアップ
    const result = await testServer.setupTestEnvironment({ createUser: true });
    testUser = result.testUser;
    console.log('Test user created:', { userId: testUser.id, name: testUser.name });
    authCookie = result.authCookie;
    authRequest = testServer.authenticatedRequest(authCookie);

    // テスト投稿の作成
    try {
      console.log('Creating test micropost...');
      testMicropost = await prisma.micropost.create({
        data: {
          title: 'いいねテスト用の投稿',
          userId: testUser.id
        }
      });
      console.log('Test micropost created:', { micropostId: testMicropost.id, title: testMicropost.title });

      // 投稿の作成後に確認
      const createdPost = await prisma.micropost.findUnique({
        where: { id: testMicropost.id },
        include: { user: true }
      });
      console.log('Created post details:', {
        id: createdPost.id,
        title: createdPost.title,
        userId: createdPost.userId,
        userName: createdPost.user.name
      });
    } catch (error) {
      console.error('Failed to create test micropost:', error);
      throw error;
    }
    console.log('--- Test Case Setup Complete ---\n');
  });

  describe('いいね操作のテスト', () => {
    it('投稿詳細ページでいいね数が正しく表示されること', async () => {
      console.log('\nTesting: Like count display on micropost page');
      // 別のユーザーを作成
      console.log('Creating another test user...');
      const otherUser = await testServer.createOtherTestUser();
      console.log('Other user created:', { userId: otherUser.id, name: otherUser.name });

      // 複数のいいねを作成
      try {
        console.log('Creating multiple likes...');
        await prisma.like.createMany({
          data: [
            { userId: testUser.id, micropostId: testMicropost.id },
            { userId: otherUser.id, micropostId: testMicropost.id }
          ]
        });
        console.log('Multiple likes created');

        // いいねの作成を確認
        const likes = await prisma.like.findMany({
          where: { micropostId: testMicropost.id },
          include: { user: true }
        });
        console.log('Created likes:', likes.map(like => ({
          id: like.id,
          userId: like.userId,
          userName: like.user.name,
          micropostId: like.micropostId
        })));

        // いいね数を確認
        const likeCount = await prisma.like.count({
          where: { micropostId: testMicropost.id }
        });
        console.log('Total like count:', likeCount);
      } catch (error) {
        console.error('Failed to create likes:', error);
        throw error;
      }

      console.log('Fetching micropost page...');
      const response = await request(server).get(`/microposts/${testMicropost.id}`);
      console.log('Response status:', response.status);
      
      // レスポンスの内容を詳細に確認
      const hasLikeCount = response.text.includes('2 いいね');
      console.log('Response includes like count:', {
        expected: '2 いいね',
        found: hasLikeCount,
        textSnippet: response.text.substring(0, 200) // 最初の200文字を表示
      });

      // HTMLの構造をより詳細に確認
      console.log('HTML structure around like count:', {
        fullText: response.text.match(/<span class="text-sm text-gray-500 dark:text-gray-400 ml-2">[^<]*<\/span>/)?.[0] || 'Not found'
      });
      
      expect(response.status).toBe(200);
      expect(response.text).toMatch(/2 いいね/);
    });
  });

  afterEach(async () => {
    console.log('\n--- Cleanup Start ---');
    try {
      if (testMicropost?.id) {
        // クリーンアップ前の状態を確認
        const likesBeforeCleanup = await prisma.like.count({
          where: { micropostId: testMicropost.id }
        });
        console.log('Likes before cleanup:', likesBeforeCleanup);

        await prisma.like.deleteMany({ where: { micropostId: testMicropost.id } });
        await prisma.micropost.delete({ where: { id: testMicropost.id } });

        console.log('Test data cleaned up');

        // クリーンアップ後の確認
        const likesAfterCleanup = await prisma.like.count({
          where: { micropostId: testMicropost.id }
        });
        console.log('Likes after cleanup:', likesAfterCleanup);
      }
    } catch (error) {
      console.error('Cleanup failed:', error);
      console.error('Cleanup error details:', {
        message: error.message,
        code: error.code,
        meta: error.meta
      });
    }
    console.log('--- Cleanup Complete ---\n');
  });
}); 