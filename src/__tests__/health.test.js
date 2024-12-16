const request = require('supertest');
const express = require('express');
const { PrismaClient } = require('@prisma/client');

// テスト環境のセットアップ用のヘルパー関数
const setupTestEnvironment = () => {
  require('dotenv').config({ path: '.env.test' });
  return new PrismaClient({
    datasources: {
      db: {
        url: process.env.TEST_DATABASE_URL
      }
    }
  });
};

// アプリケーションインスタンスを作成するヘルパー関数
const createTestApplication = async () => {
  const application = new (require('../app').Application)();
  await application.initialize();
  return application.app;
};

describe('Health Check API Tests', () => {
  let app;
  let prisma;

  beforeAll(async () => {
    prisma = setupTestEnvironment();
  });

  beforeEach(async () => {
    app = await createTestApplication();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // 基本的なヘルスチェックのテスト
  describe('Basic Health Check', () => {
    it('GET /health - should confirm service is running', async () => {
      const response = await request(app)
        .get('/health')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toEqual({
        status: 'healthy'
      });
    });
  });

  // データベース接続のヘルスチェックのテスト
  describe('Database Health Check', () => {
    it('GET /health-db - should confirm database connection is healthy', async () => {
      const response = await request(app)
        .get('/health-db')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toEqual({
        status: 'healthy'
      });
    });
  });
}); 