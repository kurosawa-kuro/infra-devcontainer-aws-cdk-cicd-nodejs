const request = require('supertest');
const { getTestServer } = require('./setup');
const { createTestUserAndLogin, TEST_ADMIN, ensureRolesExist } = require('./utils/test-utils');
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
    await ensureRolesExist(prisma);
  });

  beforeEach(async () => {
    const { response, authCookie: cookie } = await createTestUserAndLogin(server);
    authCookie = cookie;
    
    // Get the user and ensure profile exists
    testUser = await prisma.user.findUnique({
      where: { email: 'test@example.com' },
      include: { 
        profile: true,
        userRoles: {
          include: {
            role: true
          }
        }
      }
    });

    if (!testUser.profile) {
      await prisma.userProfile.create({
        data: {
          userId: testUser.id,
          bio: 'Test bio',
          location: 'Test location',
          website: 'https://test.com',
          avatarPath: 'default_avatar.png'
        }
      });

      testUser = await prisma.user.findUnique({
        where: { email: 'test@example.com' },
        include: { 
          profile: true,
          userRoles: {
            include: {
              role: true
            }
          }
        }
      });
    }
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

    it('should successfully update avatar', async () => {
      const response = await request(server)
        .post(`/profile/${testUser.id}/edit`)
        .set('Cookie', authCookie)
        .attach('avatar', 'src/tests/fixtures/test-image.jpg')
        .expect(302);

      expect(response.header.location).toBe(`/profile/${testUser.id}`);

      const updatedUser = await prisma.user.findUnique({
        where: { id: testUser.id },
        include: { profile: true }
      });

      expect(updatedUser.profile.avatarPath).not.toBe('default_avatar.png');
      expect(updatedUser.profile.avatarPath).toMatch(/^uploads\//);
    });

    it('should not allow updating other user\'s profile as regular user', async () => {
      // Create another user
      const anotherUserData = {
        email: 'another@example.com',
        password: 'password123',
        passwordConfirmation: 'password123'
      };
      const { response: anotherUserResponse } = await createTestUserAndLogin(server, anotherUserData);
      const anotherUser = await prisma.user.findUnique({
        where: { email: anotherUserData.email }
      });

      // Try to update another user's profile with first user's auth
      await request(server)
        .post(`/profile/${anotherUser.id}/edit`)
        .set('Cookie', authCookie)
        .send({ bio: 'This should not work' })
        .expect(403);
    });
  });
}); 