const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');
require('dotenv').config();

let app;
let mongo;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  process.env.JWT_SECRET = 'testsecret';
  app = require('../src/app');
  await mongoose.connection.asPromise();
});

afterAll(async () => {
  if (mongo) await mongo.stop();
  await mongoose.disconnect();
});

async function registerAndLogin(user) {
  await request(app).post('/api/auth/register').send(user);
  const res = await request(app).post('/api/auth/login').send({ email: user.email, password: user.password });
  return res.body.token;
}

test('claim submission enforces global default limit and user override', async () => {
  const adminToken = await registerAndLogin({ name: 'Admin', email: 'admin@example.com', password: 'Secret123', role: 'admin' });
  // Need a manager for the employee
  await request(app).post('/api/auth/register').send({ name: 'MgrL', email: 'mgr.limit@example.com', password: 'Secret123', role: 'manager' });
  const mgrLogin = await request(app).post('/api/auth/login').send({ email: 'mgr.limit@example.com', password: 'Secret123' });
  const managerId = mgrLogin.body.user._id;
  await request(app).post('/api/auth/register').send({ name: 'Emp', email: 'emp.limit@example.com', password: 'Secret123', role: 'employee', manager: managerId });
  const employeeTokenRes = await request(app).post('/api/auth/login').send({ email: 'emp.limit@example.com', password: 'Secret123' });
  const employeeToken = employeeTokenRes.body.token;

  // Lower global limit to 100
  const cfgRes = await request(app)
    .patch('/api/config')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ defaultClaimLimit: 100 });
  expect(cfgRes.status).toBe(200);

  // Create claim above limit (150)
  const draftHigh = await request(app)
    .post('/api/claims')
    .set('Authorization', `Bearer ${employeeToken}`)
    .attach('receipt', Buffer.from('dummy'), 'r1.pdf')
    .field('title', 'High Expense')
    .field('amount', '150');
  expect(draftHigh.status).toBe(201);

  // Attempt submit -> should be rejected due to limit
  const submitHigh = await request(app)
    .put(`/api/claims/${draftHigh.body.claim._id}/submit`)
    .set('Authorization', `Bearer ${employeeToken}`);
  expect(submitHigh.status).toBe(400);

  // Create claim within limit (80) and submit successfully
  const draftOk = await request(app)
    .post('/api/claims')
    .set('Authorization', `Bearer ${employeeToken}`)
    .attach('receipt', Buffer.from('dummy'), 'r2.pdf')
    .field('title', 'Low Expense')
    .field('amount', '80');
  expect(draftOk.status).toBe(201);

  const submitOk = await request(app)
    .put(`/api/claims/${draftOk.body.claim._id}/submit`)
    .set('Authorization', `Bearer ${employeeToken}`);
  expect(submitOk.status).toBe(200);
  expect(submitOk.body.claim.status).toBe('submitted');

  // Now set a user override to 50 and ensure new higher claim blocked
  const setOverride = await request(app)
    .patch(`/api/users/${submitOk.body.claim.user}/limit`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ claimLimit: 50 });
  expect(setOverride.status).toBe(200);

  const draftAboveOverride = await request(app)
    .post('/api/claims')
    .set('Authorization', `Bearer ${employeeToken}`)
    .attach('receipt', Buffer.from('dummy'), 'r3.pdf')
    .field('title', 'Above Override')
    .field('amount', '60');
  expect(draftAboveOverride.status).toBe(201);

  const submitAboveOverride = await request(app)
    .put(`/api/claims/${draftAboveOverride.body.claim._id}/submit`)
    .set('Authorization', `Bearer ${employeeToken}`);
  expect(submitAboveOverride.status).toBe(400);
});
