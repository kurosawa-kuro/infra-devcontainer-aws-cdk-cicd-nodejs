const request = require('supertest');
const { getTestServer } = require('./test-setup');

describe('コメント機能の統合テスト', () => {
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
    // 一般ユーザーのセットアップ
    const userResult = await testServer.setupTestEnvironment({ createUser: true });
    testUser = userResult.testUser;
    console.log('Test user created:', { userId: testUser.id, name: testUser.name });
    authCookie = userResult.authCookie;
    authRequest = testServer.authenticatedRequest(authCookie);

    // テスト投稿の作成
    try {
      console.log('Creating test micropost...');
      testMicropost = await prisma.micropost.create({
        data: {
          title: 'Test post for comments',
          userId: testUser.id
        }
      });
      console.log('Test micropost created:', { micropostId: testMicropost.id });
    } catch (error) {
      console.error('Failed to create test micropost:', error);
      throw error;
    }
    console.log('--- Test Case Setup Complete ---\n');
  });

  describe('コメント表示機能', () => {
    it('コメントがない場合、適切なメッセージが表示されること', async () => {
      console.log('\nTesting: No comments message');
      const response = await request(server).get(`/microposts/${testMicropost.id}`);
      console.log('Response status:', response.status);
      console.log('Response includes expected message:', response.text.includes('まだコメントはありません'));
      expect(response.status).toBe(200);
      expect(response.text).toContain('まだコメントはありません');
    });

    it('既存のコメントが表示されること', async () => {
      console.log('\nTesting: Existing comment display');
      const commentContent = 'テストコメントです';
      try {
        console.log('Creating test comment...');
        const comment = await prisma.comment.create({
          data: {
            content: commentContent,
            userId: testUser.id,
            micropostId: testMicropost.id
          }
        });
        console.log('Test comment created:', { commentId: comment.id });
      } catch (error) {
        console.error('Failed to create test comment:', error);
        throw error;
      }

      const response = await request(server).get(`/microposts/${testMicropost.id}`);
      console.log('Response status:', response.status);
      console.log('Response includes comment:', response.text.includes(commentContent));
      console.log('Response includes user name:', response.text.includes(testUser.name));
      expect(response.status).toBe(200);
      expect(response.text).toContain(commentContent);
      expect(response.text).toContain(testUser.name);
      expect(response.text).not.toContain('まだコメントはありません');
    });
  });

  afterEach(async () => {
    console.log('\n--- Cleanup Start ---');
    try {
      if (testMicropost?.id) {
        await prisma.comment.deleteMany({ where: { micropostId: testMicropost.id } });
        await prisma.micropost.delete({ where: { id: testMicropost.id } });
        console.log('Test data cleaned up');
      }
    } catch (error) {
      console.error('Cleanup failed:', error);
    }
    console.log('--- Cleanup Complete ---\n');
  });
}); 