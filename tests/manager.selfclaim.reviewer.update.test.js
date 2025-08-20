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

// Test updating reviewer manager on a manager's draft claim

test('manager can change reviewer manager on draft claim', async () => {
  await register({ name:'MgrA', email:'a@example.com', password:'Secret123', role:'manager' });
  await register({ name:'MgrB', email:'b@example.com', password:'Secret123', role:'manager' });
  await register({ name:'MgrC', email:'c@example.com', password:'Secret123', role:'manager' });
  const aLogin = await login('a@example.com');
  const bLogin = await login('b@example.com');
  const cLogin = await login('c@example.com');
  const aToken = aLogin.body.token; const bId = bLogin.body.user._id; const cId = cLogin.body.user._id;

  // Create draft with reviewer B
  const draft = await request(app).post('/api/claims').set(auth(aToken))
    .field('title','Hotel')
    .field('amount','80')
    .field('manager', bId)
    .attach('receipt', Buffer.from('r'), 'rec.pdf');
  expect(draft.status).toBe(201);
  expect(draft.body.claim.manager).toBe(bId);

  // Patch to change reviewer to C
  const patch1 = await request(app).patch(`/api/claims/${draft.body.claim._id}`).set(auth(aToken))
    .field('manager', cId);
  expect(patch1.status).toBe(200);
  expect(patch1.body.claim.manager).toBe(cId);

  // Patch to clear reviewer (null)
  const patch2 = await request(app).patch(`/api/claims/${draft.body.claim._id}`).set(auth(aToken))
    .field('manager', '');
  expect(patch2.status).toBe(200);
  expect(patch2.body.claim.manager).toBe(null);

  // Submit and attempt further reviewer change -> should fail with 400 (cannot edit after submission)
  await request(app).put(`/api/claims/${draft.body.claim._id}/submit`).set(auth(aToken));
  const patchAfterSubmit = await request(app).patch(`/api/claims/${draft.body.claim._id}`).set(auth(aToken))
    .field('manager', bId);
  expect(patchAfterSubmit.status).toBe(400);
});
