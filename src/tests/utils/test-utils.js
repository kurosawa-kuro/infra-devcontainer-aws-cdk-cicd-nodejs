const request = require('supertest');

const TEST_USER = {
  email: 'test@example.com',
  password: 'password123',
  passwordConfirmation: 'password123'
};

const TEST_ADMIN = {
  email: 'admin@example.com',
  password: 'admin123',
  passwordConfirmation: 'admin123'
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

async function createTestUser(server, userData = TEST_USER, isAdmin = false) {
  const response = await request(server)
    .post('/auth/signup')
    .send(userData);

  if (isAdmin && response.status === 302) {
    const prisma = require('../../app').prisma;
    const user = await prisma.user.findUnique({
      where: { email: userData.email }
    });
    const adminRole = await prisma.role.findUnique({
      where: { name: 'admin' }
    });
    await prisma.userRole.create({
      data: {
        userId: user.id,
        roleId: adminRole.id
      }
    });
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
  return {
    response,
    authCookie: response.headers['set-cookie']
  };
}

async function createTestUserAndLogin(server, userData = TEST_USER, isAdmin = false) {
  await createTestUser(server, userData, isAdmin);
  return await loginTestUser(server, {
    email: userData.email,
    password: userData.password
  });
}

async function createTestMicroposts(prisma, userId, posts = [
  { title: 'First post' },
  { title: 'Second post' }
]) {
  return await prisma.micropost.createMany({
    data: posts.map(post => ({ ...post, userId }))
  });
}

module.exports = {
  TEST_USER,
  TEST_ADMIN,
  createTestUser,
  loginTestUser,
  createTestUserAndLogin,
  createTestMicroposts,
  ensureRolesExist
}; 