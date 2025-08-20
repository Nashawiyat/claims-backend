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

async function register(user){ return request(app).post('/api/auth/register').send(user); }
async function login(email){ return request(app).post('/api/auth/login').send({ email, password:'Secret123' }); }
function auth(t){ return { Authorization: `Bearer ${t}` }; }

describe('Claim manager retrieval', () => {
  test('owner and manager can fetch; other employee blocked; finance allowed', async () => {
    await register({ name:'Mgr', email:'mgr@claimmgr.test', password:'Secret123', role:'manager' });
    const mgrLogin = await login('mgr@claimmgr.test');
    const managerId = mgrLogin.body.user._id;

    await register({ name:'Emp1', email:'emp1@claimmgr.test', password:'Secret123', role:'employee', manager: managerId });
    await register({ name:'Emp2', email:'emp2@claimmgr.test', password:'Secret123', role:'employee', manager: managerId });
    const emp1Login = await login('emp1@claimmgr.test');
    const emp2Login = await login('emp2@claimmgr.test');

    await register({ name:'Fin', email:'fin@claimmgr.test', password:'Secret123', role:'finance' });
    const finLogin = await login('fin@claimmgr.test');

    // Create claim for emp1
    const draft = await request(app).post('/api/claims').set(auth(emp1Login.body.token))
      .attach('receipt', Buffer.from('a'),'r.pdf')
      .field('title','Lunch')
      .field('amount','10');
    const claimId = draft.body.claim._id;

    // owner fetch
    const ownerFetch = await request(app).get(`/api/claims/${claimId}/manager`).set(auth(emp1Login.body.token));
    expect(ownerFetch.status).toBe(200);
    expect(ownerFetch.body.manager.email).toBe('mgr@claimmgr.test');

    // manager fetch
    const mgrFetch = await request(app).get(`/api/claims/${claimId}/manager`).set(auth(mgrLogin.body.token));
    expect(mgrFetch.status).toBe(200);

    // other employee blocked
    const otherFetch = await request(app).get(`/api/claims/${claimId}/manager`).set(auth(emp2Login.body.token));
    expect(otherFetch.status).toBe(403);

    // finance allowed
    const finFetch = await request(app).get(`/api/claims/${claimId}/manager`).set(auth(finLogin.body.token));
    expect(finFetch.status).toBe(200);
  });
});
