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
function auth(t){ return { Authorization: `Bearer ${t}` }; }

// Helper to patch config default if needed (here expecting 500 default)

describe('Remaining claim limit calculations', () => {
  test('default limit 500 decrements with submitted claims and reflected in API responses', async () => {
    await register({ name:'Mgr', email:'mgr@limitremain.test', password:'Secret123', role:'manager' });
    const mgrLogin = await login('mgr@limitremain.test');
    const managerId = mgrLogin.body.user._id;
    await register({ name:'Emp', email:'emp@limitremain.test', password:'Secret123', role:'employee', manager: managerId });
    const empLogin = await login('emp@limitremain.test');
    const token = empLogin.body.token;
    const empId = empLogin.body.user._id;

    // Initial claim limit fetch
    const limitRes1 = await request(app).get(`/api/users/${empId}/claim-limit`).set(auth(token));
    expect(limitRes1.status).toBe(200);
    expect(limitRes1.body.effectiveClaimLimit).toBe(500);
    expect(limitRes1.body.remainingClaimLimit).toBe(500);

    // Create and submit a 120 claim
    const draft = await request(app).post('/api/claims').set(auth(token))
      .attach('receipt', Buffer.from('a'),'r.pdf')
      .field('title','Taxi')
      .field('amount','120');
    expect(draft.status).toBe(201);
    const submit = await request(app).put(`/api/claims/${draft.body.claim._id}/submit`).set(auth(token));
    expect(submit.status).toBe(200);
    expect(submit.body.effectiveClaimLimit).toBe(500);
    expect(submit.body.remainingClaimLimit).toBe(500 - 120);

    // Fetch limit again
    const limitRes2 = await request(app).get(`/api/users/${empId}/claim-limit`).set(auth(token));
    expect(limitRes2.body.remainingClaimLimit).toBe(380);

    // Create and submit another 380 claim (should succeed and reach zero)
    const draft2 = await request(app).post('/api/claims').set(auth(token))
      .attach('receipt', Buffer.from('b'),'r2.pdf')
      .field('title','Hotel')
      .field('amount','380');
    const submit2 = await request(app).put(`/api/claims/${draft2.body.claim._id}/submit`).set(auth(token));
    expect(submit2.status).toBe(200);
    expect(submit2.body.remainingClaimLimit).toBe(0);

    // Attempt claim above remaining limit -> should be blocked at submit stage
    const draft3 = await request(app).post('/api/claims').set(auth(token))
      .attach('receipt', Buffer.from('c'),'r3.pdf')
      .field('title','Over')
      .field('amount','10');
    const submit3 = await request(app).put(`/api/claims/${draft3.body.claim._id}/submit`).set(auth(token));
    expect(submit3.status).toBe(400); // exceeds allowed limit (would be >500 total)
  });
});
