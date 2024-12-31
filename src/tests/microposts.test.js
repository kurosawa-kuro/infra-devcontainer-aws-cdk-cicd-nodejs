const request = require('supertest');
const { getTestServer } = require('./setup');
const { createTestUserAndLogin, createTestMicroposts } = require('./utils/test-utils');

describe('Micropost Integration Tests', () => {
  const testServer = getTestServer();
  let server;
  let prisma;
  let testUser;
  let authCookie;

  beforeAll(() => {
    server = testServer.getServer();
    prisma = testServer.getPrisma();
  });

  beforeEach(async () => {
    const { response, authCookie: cookie } = await createTestUserAndLogin(server);
    authCookie = cookie;
    testUser = await prisma.user.findUnique({
      where: { email: 'test@example.com' }
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
    beforeEach(async () => {
      await createTestMicroposts(prisma, testUser.id);
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