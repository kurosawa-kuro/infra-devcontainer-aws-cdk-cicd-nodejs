const request = require('supertest');
const { getTestServer } = require('./test-setup');
const path = require('path');

describe('UserProfile Integration Tests', () => {
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

  describe('View Profile', () => {
    it('should show user profile page with role information', async () => {
      const response = await request(server)
        .get(`/profile/${testUser.id}`)
        .set('Cookie', authCookie)
        .expect(200);

      expect(response.text).toContain(testUser.email);
      expect(response.text).toContain('user');
      expect(response.text).not.toContain('admin');
    });
  });

  describe('Update Profile', () => {
    it('should successfully update user profile', async () => {
      const updatedProfile = {
        bio: 'This is my test bio',
        location: 'Tokyo, Japan',
        website: 'https://example.com'
      };

      const response = await request(server)
        .post(`/profile/${testUser.id}/edit`)
        .set('Cookie', authCookie)
        .send(updatedProfile)
        .expect(302);

      expect(response.header.location).toBe(`/profile/${testUser.id}`);

      const updatedUser = await prisma.user.findUnique({
        where: { id: testUser.id },
        include: { 
          profile: true,
          userRoles: {
            include: {
              role: true
            }
          }
        }
      });

      expect(updatedUser.profile.bio).toBe(updatedProfile.bio);
      expect(updatedUser.profile.location).toBe(updatedProfile.location);
      expect(updatedUser.profile.website).toBe(updatedProfile.website);
    });
  });
}); 