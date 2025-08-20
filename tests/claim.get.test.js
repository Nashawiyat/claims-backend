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

// Scenario: Manager A creates claim selecting Manager B as reviewer.
// Manager B should be able to GET the claim and see creator info.

 test('assigned manager can view another manager\'s claim and see creator field', async () => {
  await register({ name:'MgrA', email:'ma@example.com', password:'Secret123', role:'manager' });
  await register({ name:'MgrB', email:'mb@example.com', password:'Secret123', role:'manager' });
  const aLogin = await login('ma@example.com');
  const bLogin = await login('mb@example.com');
  const aToken = aLogin.body.token; const bToken = bLogin.body.token;

  const draft = await request(app).post('/api/claims').set(auth(aToken))
    .field('title','Hotel')
    .field('amount','120')
    .field('manager', bLogin.body.user._id)
    .attach('receipt', Buffer.from('x'), 'hotel.pdf');
  const claimId = draft.body.claim._id;
  await request(app).put(`/api/claims/${claimId}/submit`).set(auth(aToken));

  const getByReviewer = await request(app).get(`/api/claims/${claimId}`).set(auth(bToken));
  expect(getByReviewer.status).toBe(200);
  expect(getByReviewer.body.creator).toBeDefined();
  expect(getByReviewer.body.creator.email).toBe('ma@example.com');
  expect(getByReviewer.body.claim._id).toBe(claimId);
 });

 test('unauthorized manager cannot view unrelated manager claim', async () => {
  await register({ name:'MgrC', email:'mc@example.com', password:'Secret123', role:'manager' });
  await register({ name:'MgrD', email:'md@example.com', password:'Secret123', role:'manager' });
  await register({ name:'MgrE', email:'me@example.com', password:'Secret123', role:'manager' });
  const cLogin = await login('mc@example.com');
  const dLogin = await login('md@example.com');
  const eLogin = await login('me@example.com');
  const cToken = cLogin.body.token; const dToken = dLogin.body.token; const eToken = eLogin.body.token;
  const draft = await request(app).post('/api/claims').set(auth(cToken))
    .field('title','Taxi')
    .field('amount','30')
    .field('manager', dLogin.body.user._id)
    .attach('receipt', Buffer.from('t'), 'taxi.pdf');
  const claimId = draft.body.claim._id;
  await request(app).put(`/api/claims/${claimId}/submit`).set(auth(cToken));
  const getUnauthorized = await request(app).get(`/api/claims/${claimId}`).set(auth(eToken));
  expect(getUnauthorized.status).toBe(403);
 });
