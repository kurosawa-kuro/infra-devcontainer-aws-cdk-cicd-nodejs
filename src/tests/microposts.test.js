const request = require('supertest');
const { getTestServer } = require('./setup');
const { createTestUserAndLogin, createTestMicroposts, TEST_ADMIN, ensureRolesExist } = require('./utils/test-utils');

describe('Micropost Integration Tests', () => {
  const testServer = getTestServer();
  let server;
  let prisma;
  let testUser;
  let authCookie;

  beforeAll(async () => {
    server = testServer.getServer();
    prisma = testServer.getPrisma();
    await ensureRolesExist(prisma);
  });

  beforeEach(async () => {
    const { response, authCookie: cookie } = await createTestUserAndLogin(server);
    authCookie = cookie;
    testUser = await prisma.user.findUnique({
      where: { email: 'test@example.com' },
      include: {
        userRoles: {
          include: {
            role: true
          }
        }
      }
    });
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

      const micropost = await prisma.micropost.findFirst({
        where: { title: postTitle }
      });
      expect(micropost).toBeTruthy();
      expect(micropost.title).toBe(postTitle);
      expect(micropost.userId).toBe(testUser.id);
      expect(micropost.imageUrl).toBeTruthy();
      expect(micropost.imageUrl).toMatch(/^uploads\//);
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
    let adminUser;
    let adminCookie;

    beforeEach(async () => {
      // Create posts for regular user
      await createTestMicroposts(prisma, testUser.id);

      // Create admin user and their posts
      const { response, authCookie: cookie } = await createTestUserAndLogin(server, TEST_ADMIN, true);
      adminCookie = cookie;
      adminUser = await prisma.user.findUnique({
        where: { email: TEST_ADMIN.email }
      });
      await createTestMicroposts(prisma, adminUser.id, [
        { title: 'Admin post 1' },
        { title: 'Admin post 2' }
      ]);
    });

    it('should list all microposts on home page for regular user', async () => {
      const response = await request(server)
        .get('/microposts')
        .set('Cookie', authCookie)
        .expect(200);

      expect(response.text).toContain('First post');
      expect(response.text).toContain('Second post');
      expect(response.text).toContain('Admin post 1');
      expect(response.text).toContain('Admin post 2');
    });

    it('should list all microposts on home page for admin', async () => {
      const response = await request(server)
        .get('/microposts')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(response.text).toContain('First post');
      expect(response.text).toContain('Second post');
      expect(response.text).toContain('Admin post 1');
      expect(response.text).toContain('Admin post 2');
    });

    it('should show admin badge for admin user posts', async () => {
      const response = await request(server)
        .get('/microposts')
        .set('Cookie', authCookie)
        .expect(200);

      // Admin posts should be marked with an admin badge
      expect(response.text).toMatch(/Admin post 1.*管理者/);
      expect(response.text).toMatch(/Admin post 2.*管理者/);
    });
  });
}); 