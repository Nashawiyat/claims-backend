const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');
require('dotenv').config();

let app; let mongo;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  process.env.JWT_SECRET = 'testsecret';
  app = require('../src/app');
  await mongoose.connection.asPromise();
});

afterAll(async () => { if (mongo) await mongo.stop(); await mongoose.disconnect(); });

async function register(data){ return request(app).post('/api/auth/register').send(data); }
async function login(email){ return request(app).post('/api/auth/login').send({ email, password:'Secret123' }); }

function auth(token){ return { Authorization: `Bearer ${token}` }; }

test('manager can create & submit own claim but cannot approve/reject it; admin can approve', async () => {
  await register({ name:'M1', email:'m1@example.com', password:'Secret123', role:'manager' });
  await register({ name:'M2', email:'m2@example.com', password:'Secret123', role:'manager' });
  await register({ name:'Admin', email:'admin@example.com', password:'Secret123', role:'admin' });

  const m1Login = await login('m1@example.com');
  const m2Login = await login('m2@example.com');
  const adminLogin = await login('admin@example.com');
  const m1Token = m1Login.body.token; const m2Token = m2Login.body.token; const adminToken = adminLogin.body.token;

  // Manager1 creates draft
  const draft = await request(app).post('/api/claims').set(auth(m1Token))
    .attach('receipt', Buffer.from('a'), 'r.pdf')
    .field('title','Mgr Expense')
    .field('amount','25');
  expect(draft.status).toBe(201);
  const claimId = draft.body.claim._id;

  // Submit
  const submit = await request(app).put(`/api/claims/${claimId}/submit`).set(auth(m1Token));
  expect(submit.status).toBe(200);
  expect(submit.body.claim.status).toBe('submitted');

  // Manager1 tries to approve own claim -> 403
  const selfApprove = await request(app).put(`/api/claims/${claimId}/approve`).set(auth(m1Token));
  expect(selfApprove.status).toBe(403);

  // Another manager can approve
  const otherApprove = await request(app).put(`/api/claims/${claimId}/approve`).set(auth(m2Token));
  expect(otherApprove.status).toBe(200);

  // Manager1 tries to reject own already approved claim -> 403
  const selfReject = await request(app).put(`/api/claims/${claimId}/reject`).set(auth(m1Token)).send({ reason:'n/a'});
  expect(selfReject.status).toBe(403);

  // Admin can approve a different manager's new claim too (create second claim)
  const draft2 = await request(app).post('/api/claims').set(auth(m1Token))
    .attach('receipt', Buffer.from('b'),'r2.pdf')
    .field('title','Another')
    .field('amount','10');
  const claim2 = draft2.body.claim._id;
  await request(app).put(`/api/claims/${claim2}/submit`).set(auth(m1Token));
  const adminApprove = await request(app).put(`/api/claims/${claim2}/approve`).set(auth(adminToken));
  expect(adminApprove.status).toBe(200);
});
