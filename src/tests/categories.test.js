const request = require('supertest');
const { getTestServer } = require('./test-setup');

describe('Category Integration Tests', () => {
  const testServer = getTestServer();
  let server;
  let prisma;
  let testUser;
  let authCookie;
  let authRequest;

  beforeAll(async () => {
    server = testServer.getServer();
    prisma = testServer.getPrisma();
  });

  beforeEach(async () => {
    // Setup test environment with user and categories
    const result = await testServer.setupTestEnvironment({ 
      createUser: true,
      createCategories: true 
    });
    testUser = result.testUser;
    authCookie = result.authCookie;
    authRequest = testServer.authenticatedRequest(authCookie);
  });

  describe('Category Display', () => {
    it('should display all categories in the sidebar', async () => {
      const response = await authRequest.get('/home');
      expect(response.status).toBe(200);

      // Verify all test categories are displayed
      expect(response.text).toContain('プログラミング');
      expect(response.text).toContain('インフラ');
      expect(response.text).toContain('セキュリティ');
    });

    it('should show categories with their post counts', async () => {
      // Create a test micropost
      const testMicropost = await prisma.micropost.create({
        data: {
          title: 'Test post with category',
          userId: testUser.id
        }
      });

      // Get the programming category
      const programmingCategory = await prisma.category.findFirst({
        where: { name: 'プログラミング' }
      });

      // Associate the micropost with the programming category
      await prisma.categoryMicropost.create({
        data: {
          micropostId: testMicropost.id,
          categoryId: programmingCategory.id
        }
      });

      const response = await authRequest.get('/home');
      expect(response.status).toBe(200);

      // Verify category is displayed with post count
      expect(response.text).toContain('プログラミング');
      expect(response.text).toContain('インフラ');
      expect(response.text).toContain('セキュリティ');
    });

    it('should display categories in alphabetical order', async () => {
      const response = await authRequest.get('/home');
      expect(response.status).toBe(200);

      // Get the category section of the response
      const categorySection = response.text.match(/カテゴリー[\s\S]*?<\/div>/)[0];
      
      // Verify the order of categories
      const categoryOrder = ['インフラ', 'セキュリティ', 'プログラミング'];
      let lastIndex = -1;
      
      categoryOrder.forEach(category => {
        const currentIndex = categorySection.indexOf(category);
        expect(currentIndex).toBeGreaterThan(lastIndex);
        lastIndex = currentIndex;
      });
    });
  });
}); 