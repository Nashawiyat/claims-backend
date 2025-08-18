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

afterAll(async () => {
  if (mongo) await mongo.stop();
  await mongoose.disconnect();
});

async function register(user) {
  return request(app).post('/api/auth/register').send(user);
}
async function login(email, password='Secret123') {
  return request(app).post('/api/auth/login').send({ email, password });
}
async function token(email) {
  const res = await login(email); return res.body.token;
}

test('manager can only approve claims of direct reports; admin can approve any', async () => {
  await register({ name:'MgrA', email:'mgra@example.com', password:'Secret123', role:'manager' });
  await register({ name:'MgrB', email:'mgrb@example.com', password:'Secret123', role:'manager' });
  await register({ name:'Admin', email:'admin@example.com', password:'Secret123', role:'admin' });
  // Employees with manager assignments
  await register({ name:'Emp1', email:'emp1@example.com', password:'Secret123', role:'employee', manager: (await login('mgra@example.com')).body.user._id });
  await register({ name:'Emp2', email:'emp2@example.com', password:'Secret123', role:'employee', manager: (await login('mgrb@example.com')).body.user._id });

  const mgrAToken = await token('mgra@example.com');
  const mgrBToken = await token('mgrb@example.com');
  const adminToken = await token('admin@example.com');
  const emp1Token = await token('emp1@example.com');
  const emp2Token = await token('emp2@example.com');

  // Create draft claims
  const c1 = await request(app).post('/api/claims').set('Authorization',`Bearer ${emp1Token}`)
    .attach('receipt', Buffer.from('x'),'r.pdf').field('title','Claim1').field('amount','10');
  const c2 = await request(app).post('/api/claims').set('Authorization',`Bearer ${emp2Token}`)
    .attach('receipt', Buffer.from('x'),'r2.pdf').field('title','Claim2').field('amount','20');
  const id1 = c1.body.claim._id; const id2 = c2.body.claim._id;
  await request(app).put(`/api/claims/${id1}/submit`).set('Authorization',`Bearer ${emp1Token}`);
  await request(app).put(`/api/claims/${id2}/submit`).set('Authorization',`Bearer ${emp2Token}`);

  // Manager A tries to approve claim of Emp2 (not direct report) -> 403
  const mgrAApproveForeign = await request(app).put(`/api/claims/${id2}/approve`).set('Authorization',`Bearer ${mgrAToken}`);
  expect(mgrAApproveForeign.status).toBe(403);

  // Manager B approves own report
  const mgrBApproveOwn = await request(app).put(`/api/claims/${id2}/approve`).set('Authorization',`Bearer ${mgrBToken}`);
  expect(mgrBApproveOwn.status).toBe(200);

  // Admin approves remaining submitted claim regardless of manager
  const adminApprove = await request(app).put(`/api/claims/${id1}/approve`).set('Authorization',`Bearer ${adminToken}`);
  expect(adminApprove.status).toBe(200);
});
