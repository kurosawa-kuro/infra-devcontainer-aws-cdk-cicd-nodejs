const request = require('supertest');
const { getTestServer, TEST_ADMIN } = require('./test-setup');

describe('Micropost Integration Tests', () => {
  const testServer = getTestServer();
  let server;
  let prisma;
  let testUser;
  let authCookie;

  beforeAll(async () => {
    server = testServer.getServer();
    prisma = testServer.getPrisma();
  });

  beforeEach(async () => {
    const result = await testServer.createTestUserAndLogin();
    authCookie = result.authCookie;
    testUser = result.user;
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
      await testServer.createTestMicroposts(testUser.id);

      // Create admin user and their posts
      const adminResult = await testServer.createTestUserAndLogin(TEST_ADMIN, true);
      adminCookie = adminResult.authCookie;
      adminUser = adminResult.user;
      await testServer.createTestMicroposts(adminUser.id, [
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
  });
}); 