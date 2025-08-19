const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
require('dotenv').config();

let app; let mongo;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  process.env.JWT_SECRET = 'testsecret';
  process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
  app = require('../src/app');
  await mongoose.connection.asPromise();
});

afterAll(async () => { if (mongo) await mongo.stop(); await mongoose.disconnect(); });

test('OPTIONS preflight on /api/auth/login returns CORS headers', async () => {
  const res = await request(app).options('/api/auth/login');
  expect([200,204]).toContain(res.status);
  expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  expect(res.headers['access-control-allow-credentials']).toBe('true');
  expect(res.headers['access-control-allow-headers']).toMatch(/authorization/i);
  expect(res.headers['access-control-allow-methods']).toMatch(/options/i);
});
