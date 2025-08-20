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

// New behaviour: manager can select another manager as reviewer at creation

test('manager can assign another manager reviewer when creating claim; assigned manager can see it', async () => {
  await register({ name:'MgrA', email:'a@example.com', password:'Secret123', role:'manager' });
  await register({ name:'MgrB', email:'b@example.com', password:'Secret123', role:'manager' });
  const aLogin = await login('a@example.com');
  const bLogin = await login('b@example.com');
  const aToken = aLogin.body.token; const bToken = bLogin.body.token;

  // Manager A creates claim specifying Manager B as reviewer
  const draft = await request(app).post('/api/claims').set(auth(aToken))
    .field('title','Conference')
    .field('amount','75')
    .field('manager', bLogin.body.user._id) // choosing reviewer
    .attach('receipt', Buffer.from('file'), 'conf.pdf');
  expect(draft.status).toBe(201);
  expect(draft.body.claim.manager).toBe(bLogin.body.user._id);

  // Manager B lists submitted claims (should be empty because still draft)
  const listBefore = await request(app).get('/api/claims/manager').set(auth(bToken));
  expect(Array.isArray(listBefore.body.claims) ? listBefore.body.claims.length : 0).toBe(0);

  // Submit the claim
  const submit = await request(app).put(`/api/claims/${draft.body.claim._id}/submit`).set(auth(aToken));
  expect(submit.status).toBe(200);

  // Manager B lists submitted claims -> should include the claim
  const listAfter = await request(app).get('/api/claims/manager').set(auth(bToken));
  const afterClaims = Array.isArray(listAfter.body.claims) ? listAfter.body.claims : [];
  expect(afterClaims.some(c => c._id === draft.body.claim._id)).toBe(true);
});

// Validation: cannot assign self as reviewer

test('manager cannot assign self as reviewing manager', async () => {
  await register({ name:'MgrC', email:'c@example.com', password:'Secret123', role:'manager' });
  const cLogin = await login('c@example.com');
  const cToken = cLogin.body.token;
  const bad = await request(app).post('/api/claims').set(auth(cToken))
    .field('title','Self')
    .field('amount','10')
    .field('manager', cLogin.body.user._id)
    .attach('receipt', Buffer.from('file'),'self.pdf');
  expect(bad.status).toBe(400);
  expect(bad.body.message).toMatch(/Cannot assign yourself/);
});
