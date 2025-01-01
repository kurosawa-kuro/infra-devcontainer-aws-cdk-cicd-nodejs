const request = require('supertest');

const TEST_USER = {
  email: 'test@example.com',
  password: 'password123',
  passwordConfirmation: 'password123',
  name: 'TestUser123',
  terms: 'on'
};

const TEST_ADMIN = {
  email: 'admin@example.com',
  password: 'admin123',
  passwordConfirmation: 'admin123',
  name: 'AdminUser123',
  terms: 'on'
};

async function ensureRolesExist(prisma) {
  const roles = ['user', 'admin'];
  for (const roleName of roles) {
    await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: {
        name: roleName,
        description: `${roleName} role`
      }
    });
  }
}

async function createTestUser(server, userData = TEST_USER, isAdmin = false, prismaInstance = null) {
  // Add terms acceptance if not present
  const signupData = { ...userData, terms: userData.terms || 'on' };
  
  console.log('Attempting to create test user with data:', signupData);
  
  const response = await request(server)
    .post('/auth/signup')
    .send(signupData);

  console.log('Signup response status:', response.status);
  console.log('Signup response body:', response.body);
  console.log('Signup response headers:', response.headers);

  if (!response.headers['set-cookie']) {
    throw new Error('No session cookie returned from signup');
  }

  if (prismaInstance) {
    console.log('Checking database for created user...');
    let user = await prismaInstance.user.findUnique({
      where: { email: userData.email },
      include: {
        userRoles: {
          include: {
            role: true
          }
        }
      }
    });

    console.log('Database query result:', user);

    if (!user) {
      throw new Error('User not created during signup');
    }

    if (isAdmin) {
      const adminRole = await prismaInstance.role.findUnique({
        where: { name: 'admin' }
      });
      if (!adminRole) {
        throw new Error('Admin role not found');
      }
      await prismaInstance.userRole.create({
        data: {
          userId: user.id,
          roleId: adminRole.id
        }
      });

      // Re-fetch user with updated roles
      user = await prismaInstance.user.findUnique({
        where: { email: userData.email },
        include: {
          userRoles: {
            include: {
              role: true
            }
          }
        }
      });
    }

    // Create a default profile for the user
    await prismaInstance.userProfile.create({
      data: {
        userId: user.id,
        bio: isAdmin ? 'Admin bio' : 'User bio',
        location: isAdmin ? 'Admin location' : 'User location',
        website: isAdmin ? 'https://admin.com' : 'https://user.com',
        avatarPath: 'default_avatar.png'
      }
    });

    return {
      response,
      user
    };
  }

  return response;
}

async function loginTestUser(server, credentials = { 
  email: TEST_USER.email, 
  password: TEST_USER.password 
}) {
  const response = await request(server)
    .post('/auth/login')
    .send(credentials);

  if (!response.headers['set-cookie']) {
    throw new Error('No session cookie returned from login');
  }

  return {
    response,
    authCookie: response.headers['set-cookie']
  };
}

async function logoutTestUser(server, authCookie) {
  const response = await request(server)
    .get('/auth/logout')
    .set('Cookie', authCookie);

  expect(response.status).toBe(302);
  expect(response.header.location).toBe('/auth/login');

  return response;
}

async function createTestUserAndLogin(server, userData = TEST_USER, isAdmin = false, prismaInstance = null) {
  const { response: signupResponse, user } = await createTestUser(server, userData, isAdmin, prismaInstance);
  const loginResult = await loginTestUser(server, {
    email: userData.email,
    password: userData.password
  });

  if (!loginResult.authCookie) {
    throw new Error('Login failed - no auth cookie');
  }

  return {
    ...loginResult,
    user
  };
}

async function createTestMicroposts(prisma, userId, posts = [
  { title: 'First post' },
  { title: 'Second post' }
]) {
  return await prisma.micropost.createMany({
    data: posts.map(post => ({ ...post, userId }))
  });
}

// 共通のテストセットアップ関数
async function setupTestEnvironment(server, prisma, options = {}) {
  const {
    createUser = true,
    isAdmin = false,
    createMicroposts = false,
    createCategories = false
  } = options;

  let testUser;
  let authCookie;

  if (createUser) {
    const result = await createTestUserAndLogin(server, undefined, isAdmin, prisma);
    testUser = result.user;
    authCookie = result.authCookie;
  }

  if (createMicroposts && testUser) {
    await createTestMicroposts(prisma, testUser.id);
  }

  if (createCategories) {
    await prisma.category.createMany({
      data: [
        { name: 'プログラミング' },
        { name: 'インフラ' },
        { name: 'セキュリティ' }
      ]
    });
  }

  return { testUser, authCookie };
}

// 認証付きリクエストヘルパー
async function authenticatedRequest(server, authCookie) {
  return {
    get: (url) => request(server).get(url).set('Cookie', authCookie),
    post: (url, data) => request(server).post(url).set('Cookie', authCookie).send(data),
    put: (url, data) => request(server).put(url).set('Cookie', authCookie).send(data),
    delete: (url) => request(server).delete(url).set('Cookie', authCookie)
  };
}

// テストユーザーの作成
async function createOtherTestUser(prisma, email = 'other@example.com', name = 'OtherUser') {
  return await prisma.user.create({
    data: {
      email,
      password: '$2b$10$77777777777777777777777777777777777777777777777777',
      name,
      profile: {
        create: {
          avatarPath: '/uploads/default_avatar.png'
        }
      }
    },
    include: {
      profile: true
    }
  });
}

module.exports = {
  TEST_USER,
  TEST_ADMIN,
  createTestUser,
  loginTestUser,
  logoutTestUser,
  createTestUserAndLogin,
  createTestMicroposts,
  ensureRolesExist,
  setupTestEnvironment,
  authenticatedRequest,
  createOtherTestUser
}; 