const request = require('supertest');

const TEST_USER = {
  email: 'test@example.com',
  password: 'password123',
  passwordConfirmation: 'password123'
};

async function createTestUser(server, userData = TEST_USER) {
  const response = await request(server)
    .post('/auth/signup')
    .send(userData);
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

async function createTestUserAndLogin(server, userData = TEST_USER) {
  await createTestUser(server, userData);
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
  createTestUser,
  loginTestUser,
  createTestUserAndLogin,
  createTestMicroposts
}; 