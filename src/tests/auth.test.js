const { getTestServer } = require('./test-setup');

describe('Authentication Integration Tests', () => {
  const testServer = getTestServer();

  describe('User Registration', () => {
    it('should successfully register a new user with default role', async () => {
      const response = await testServer.agent
        .post('/auth/signup')
        .send({
          email: 'test@example.com',
          password: 'password123',
          name: 'TestUser123',
          terms: 'on',
          _csrf: 'test-csrf-token'
        });

      expect(response.status).toBe(302);
      expect(response.header.location).toBe('/');

      // ユーザー情報の検証
      const user = await testServer.prisma.user.findUnique({
        where: { email: 'test@example.com' },
        include: {
          profile: true,
          userRoles: {
            include: { role: true }
          }
        }
      });

      expect(user).toBeTruthy();
      expect(user.email).toBe('test@example.com');
      expect(user.name).toBe('TestUser123');

      // プロフィールの検証
      expect(user.profile).toBeTruthy();
      expect(user.profile.avatarPath).toBe('/uploads/default-avatar.png');
      
      // ユーザーロールの検証
      expect(user.userRoles).toHaveLength(1);
      expect(user.userRoles[0].role.name).toBe('user');
    });

    it('should successfully create an admin user', async () => {
      const response = await testServer.agent
        .post('/auth/signup')
        .send({
          email: 'admin@example.com',
          password: 'admin123',
          name: 'AdminUser123',
          terms: 'on',
          _csrf: 'test-csrf-token'
        });

      expect(response.status).toBe(302);
      expect(response.header.location).toBe('/');

      // 管理者ロールの追加
      const user = await testServer.prisma.user.findUnique({
        where: { email: 'admin@example.com' }
      });

      await testServer.prisma.userRole.create({
        data: {
          user: {
            connect: { id: user.id }
          },
          role: {
            connect: { name: 'admin' }
          }
        }
      });

      // 更新されたユーザー情報の検証
      const updatedUser = await testServer.prisma.user.findUnique({
        where: { email: 'admin@example.com' },
        include: {
          profile: true,
          userRoles: {
            include: { role: true }
          }
        }
      });

      expect(updatedUser).toBeTruthy();
      expect(updatedUser.email).toBe('admin@example.com');
      expect(updatedUser.name).toBe('AdminUser123');

      // プロフィールの検証
      expect(updatedUser.profile).toBeTruthy();
      expect(updatedUser.profile.avatarPath).toBe('/uploads/default-avatar.png');
      
      // 管理者ロールの検証
      expect(updatedUser.userRoles).toHaveLength(2);
      expect(updatedUser.userRoles.map(ur => ur.role.name)).toContain('admin');
    });
  });

  describe('User Login', () => {
    beforeEach(async () => {
      await testServer.createTestUser();
    });

    it('should successfully login with correct credentials', async () => {
      const response = await testServer.agent
        .post('/auth/login')
        .send({
          email: 'test@example.com',
          password: 'password123',
          _csrf: 'test-csrf-token'
        });

      expect(response.status).toBe(302);
      expect(response.header.location).toBe('/');
      expect(response.headers['set-cookie']).toBeTruthy();
    });

    it('should include role information in session', async () => {
      const loginResponse = await testServer.agent
        .post('/auth/login')
        .send({
          email: 'test@example.com',
          password: 'password123',
          _csrf: 'test-csrf-token'
        });

      expect(loginResponse.status).toBe(302);

      const sessionResponse = await testServer.agent
        .get('/auth/session')
        .set('Accept', 'application/json');

      expect(sessionResponse.status).toBe(200);
      expect(sessionResponse.body.user).toBeTruthy();
      expect(sessionResponse.body.user.roles).toContain('user');
    });
  });
}); 