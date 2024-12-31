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

  async start() {
    process.env.NODE_ENV = 'test';
    // アプリケーションの初期化
    this.app = new Application();
    await this.app.setupMiddleware();
    await this.app.setupRoutes();
    await this.app.setupErrorHandler();

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
    await this.prisma.user.deleteMany();
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