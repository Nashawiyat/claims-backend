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

describe('Delete draft claim', () => {
  test('owner can delete draft, cannot delete after submission, non-owner forbidden', async () => {
    // setup manager and two employees
    await register({ name:'Mgr', email:'mgr.del@test.com', password:'Secret123', role:'manager' });
    const mgrLogin = await login('mgr.del@test.com');
    const managerId = mgrLogin.body.user._id;
    await register({ name:'Emp1', email:'emp1.del@test.com', password:'Secret123', role:'employee', manager: managerId });
    await register({ name:'Emp2', email:'emp2.del@test.com', password:'Secret123', role:'employee', manager: managerId });
    const emp1Login = await login('emp1.del@test.com');
    const emp2Login = await login('emp2.del@test.com');

    // create draft for emp1
    const draft = await request(app).post('/api/claims').set(auth(emp1Login.body.token))
      .attach('receipt', Buffer.from('a'), 'r.pdf')
      .field('title','Temp')
      .field('amount','10');
    expect(draft.status).toBe(201);
    const claimId = draft.body.claim._id;

    // non-owner tries delete
    const forbidden = await request(app).delete(`/api/claims/${claimId}`).set(auth(emp2Login.body.token));
    expect(forbidden.status).toBe(403);

    // owner deletes draft
    const delRes = await request(app).delete(`/api/claims/${claimId}`).set(auth(emp1Login.body.token));
    expect(delRes.status).toBe(204);

    // recreate for submission test
    const draft2 = await request(app).post('/api/claims').set(auth(emp1Login.body.token))
      .attach('receipt', Buffer.from('b'), 'r2.pdf')
      .field('title','Keep')
      .field('amount','12');
    const claim2 = draft2.body.claim._id;
    await request(app).put(`/api/claims/${claim2}/submit`).set(auth(emp1Login.body.token));

    const afterSubmitDelete = await request(app).delete(`/api/claims/${claim2}`).set(auth(emp1Login.body.token));
    expect(afterSubmitDelete.status).toBe(400);
  });
});
