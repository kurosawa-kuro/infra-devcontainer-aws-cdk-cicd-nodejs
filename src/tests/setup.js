const { PrismaClient } = require('@prisma/client');
const { Application } = require('../app');
const http = require('http');
const request = require('supertest');

class TestServer {
  constructor() {
    this.prisma = new PrismaClient();
    this.app = null;
    this.server = null;
    this.baseUrl = null;
  }

  async createDefaultRoles() {
    // Create default user role if it doesn't exist
    const userRole = await this.prisma.role.upsert({
      where: { name: 'user' },
      update: {},
      create: {
        name: 'user',
        description: 'Default user role'
      }
    });

    // Create admin role if it doesn't exist
    const adminRole = await this.prisma.role.upsert({
      where: { name: 'admin' },
      update: {},
      create: {
        name: 'admin',
        description: 'Administrator role'
      }
    });

    return { userRole, adminRole };
  }

  async start() {
    process.env.NODE_ENV = 'test';
    // アプリケーションの初期化
    this.app = new Application();
    await this.app.setupMiddleware();
    await this.app.setupRoutes();
    await this.app.setupErrorHandler();

    // Create default roles
    await this.createDefaultRoles();

    // テスト用サーバーの起動
    this.server = http.createServer(this.app.app);
    await new Promise(resolve => {
      this.server.listen(0, () => {
        this.baseUrl = `http://localhost:${this.server.address().port}`;
        console.log(`Test server started on ${this.baseUrl}`);
        resolve();
      });
    });
  }

  async cleanup() {
    if (this.server) {
      await new Promise(resolve => this.server.close(resolve));
      console.log('Test server closed');
    }
    await this.prisma.$disconnect();
    if (this.app) {
      await this.app.cleanup();
    }
  }

  async resetDatabase() {
    await this.prisma.micropost.deleteMany();
    await this.prisma.userRole.deleteMany();
    await this.prisma.userProfile.deleteMany();
    await this.prisma.user.deleteMany();
    await this.prisma.role.deleteMany();
    
    // Recreate default roles after cleanup
    await this.createDefaultRoles();
  }

  getServer() {
    return this.server;
  }

  getPrisma() {
    return this.prisma;
  }

  getBaseUrl() {
    return this.baseUrl;
  }

  getApp() {
    return this.app;
  }
}

// シングルトンインスタンス
const testServer = new TestServer();

// Jest のグローバルセットアップ
beforeAll(async () => {
  await testServer.start();
});

afterEach(async () => {
  await testServer.resetDatabase();
});

afterAll(async () => {
  await testServer.cleanup();
});

module.exports = {
  getTestServer: () => testServer
}; 