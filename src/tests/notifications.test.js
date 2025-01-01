const request = require('supertest');
const { getTestServer } = require('./setup');
const { createTestUserAndLogin, createTestMicroposts, TEST_ADMIN, ensureRolesExist } = require('./utils/test-utils');

describe('Notification Integration Tests', () => {
  const testServer = getTestServer();
  let server;
  let prisma;
  let testUser;
  let otherUser;
  let authCookie;
  let testMicropost;

  beforeAll(async () => {
    server = testServer.getServer();
    prisma = testServer.getPrisma();
    await ensureRolesExist(prisma);
  });

  beforeEach(async () => {
    // Clean up database
    await prisma.notification.deleteMany({});
    await prisma.micropost.deleteMany({});
    await prisma.userProfile.deleteMany({});
    await prisma.userRole.deleteMany({});
    await prisma.user.deleteMany({});
    await ensureRolesExist(prisma);

    // Create test user and login
    const { user, authCookie: cookie } = await createTestUserAndLogin(server, undefined, false, prisma);
    testUser = user;
    authCookie = cookie;

    // Create another user for interaction
    otherUser = await prisma.user.create({
      data: {
        email: 'other@example.com',
        password: '$2b$10$77777777777777777777777777777777777777777777777777',
        name: 'OtherUser'
      }
    });

    // Create a test micropost
    testMicropost = await prisma.micropost.create({
      data: {
        title: 'Test post',
        userId: otherUser.id
      }
    });
  });

  describe('Notification Features', () => {
    it('should display notification list correctly', async () => {
      // Create test notifications
      await prisma.notification.create({
        data: {
          type: 'LIKE',
          read: false,
          recipient: {
            connect: {
              id: testUser.id
            }
          },
          actor: {
            connect: {
              id: otherUser.id
            }
          },
          micropost: {
            connect: {
              id: testMicropost.id
            }
          }
        }
      });

      const response = await request(server)
        .get('/notifications')
        .set('Cookie', authCookie)
        .expect(200);

      // 通知一覧ページの基本要素が表示されていることを確認
      expect(response.text).toContain('通知');
      expect(response.text).toContain('OtherUser');
      expect(response.text).toContain('いいね');
    });

    it('should create notification when user likes a post', async () => {
      // いいねを実行
      await request(server)
        .post(`/microposts/${testMicropost.id}/like`)
        .set('Cookie', authCookie)
        .set('Accept', 'application/json')
        .expect(200);

      // 通知が作成されたことを確認
      const notifications = await prisma.notification.findMany({
        where: {
          type: 'LIKE',
          actor: {
            id: testUser.id
          },
          micropost: {
            id: testMicropost.id
          }
        }
      });

      expect(notifications).toHaveLength(1);
      expect(notifications[0].type).toBe('LIKE');
    });
  });
}); 