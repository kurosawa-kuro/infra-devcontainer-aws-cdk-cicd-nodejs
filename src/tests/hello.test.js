const request = require('supertest');
const app = require('../app'); // appをエクスポートする必要があります

describe('Hello Endpoints', () => {
  // GET /hello のテスト
  describe('GET /hello', () => {
    it('should return hello message', async () => {
      const res = await request(app)
        .get('/hello')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(res.body).toEqual({
        message: 'Hello, World!'
      });
    });
  });

  // POST /hello のテスト
  describe('POST /hello', () => {
    it('should return personalized hello message when name is provided', async () => {
      const res = await request(app)
        .post('/hello')
        .send({ name: 'Alice' })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(res.body).toEqual({
        message: 'Hello, Alice!'
      });
    });

    it('should return default hello message when name is not provided', async () => {
      const res = await request(app)
        .post('/hello')
        .send({})
        .expect('Content-Type', /json/)
        .expect(200);

      expect(res.body).toEqual({
        message: 'Hello, World!'
      });
    });
  });
}); 