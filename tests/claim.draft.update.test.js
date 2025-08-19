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

describe('Update draft claim', () => {
  test('owner can patch draft, cannot patch after submission, amount validation enforced', async () => {
    // manager for employee
    await register({ name:'Mgr', email:'mgr@x.com', password:'Secret123', role:'manager' });
    const mgrLogin = await login('mgr@x.com');
    const managerId = mgrLogin.body.user._id;
    await register({ name:'Emp', email:'emp@x.com', password:'Secret123', role:'employee', manager: managerId });
    const empLogin = await login('emp@x.com');
    const token = empLogin.body.token;

    // create draft
    const draft = await request(app).post('/api/claims').set(auth(token))
      .attach('receipt', Buffer.from('a'), 'r.pdf')
      .field('title','Lunch')
      .field('amount','25');
    expect(draft.status).toBe(201);
    const claimId = draft.body.claim._id;

    // patch title & amount
    const patched = await request(app).patch(`/api/claims/${claimId}`).set(auth(token))
      .field('title','Business Lunch')
      .field('amount','30');
    expect(patched.status).toBe(200);
    expect(patched.body.claim.title).toBe('Business Lunch');
    expect(patched.body.claim.amount).toBe(30);

    // invalid amount
    const badAmount = await request(app).patch(`/api/claims/${claimId}`).set(auth(token))
      .field('amount','0');
    expect(badAmount.status).toBe(400);

    // submit claim
    const submit = await request(app).put(`/api/claims/${claimId}/submit`).set(auth(token));
    expect(submit.status).toBe(200);

    // attempt further patch -> 400
    const afterSubmit = await request(app).patch(`/api/claims/${claimId}`).set(auth(token))
      .field('title','Too Late');
    expect(afterSubmit.status).toBe(400);
  });

  test('non-owner cannot patch draft', async () => {
    await register({ name:'Mgr2', email:'mgr2@x.com', password:'Secret123', role:'manager' });
    const mgr2 = await login('mgr2@x.com');
    const managerId2 = mgr2.body.user._id;
    await register({ name:'Alice', email:'alice@x.com', password:'Secret123', role:'employee', manager: managerId2 });
    await register({ name:'Bob', email:'bob@x.com', password:'Secret123', role:'employee', manager: managerId2 });
    const aliceLogin = await login('alice@x.com');
    const bobLogin = await login('bob@x.com');

    const draft = await request(app).post('/api/claims').set(auth(aliceLogin.body.token))
      .attach('receipt', Buffer.from('b'),'b.pdf')
      .field('title','Taxi')
      .field('amount','15');
    const claimId = draft.body.claim._id;

    const bobPatch = await request(app).patch(`/api/claims/${claimId}`).set(auth(bobLogin.body.token))
      .field('title','Hack');
    expect(bobPatch.status).toBe(403);
  });
});
