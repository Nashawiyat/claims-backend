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

async function registerAndLogin(user){
  await request(app).post('/api/auth/register').send(user);
  const res = await request(app).post('/api/auth/login').send({ email:user.email, password:user.password });
  return res.body.token;
}

test('finance can reject approved claim', async () => {
  await request(app).post('/api/auth/register').send({ name:'Mgr', email:'mgrfin@example.com', password:'Secret123', role:'manager' });
  const managerLogin = await request(app).post('/api/auth/login').send({ email:'mgrfin@example.com', password:'Secret123' });
  const managerToken = managerLogin.body.token; const managerId = managerLogin.body.user._id;
  const financeToken = await registerAndLogin({ name:'Fin', email:'finrej@example.com', password:'Secret123', role:'finance' });
  await request(app).post('/api/auth/register').send({ name:'Emp', email:'empfin@example.com', password:'Secret123', role:'employee', manager: managerId });
  const empLogin = await request(app).post('/api/auth/login').send({ email:'empfin@example.com', password:'Secret123' });
  const employeeToken = empLogin.body.token;

  const draft = await request(app).post('/api/claims').set('Authorization',`Bearer ${employeeToken}`)
    .attach('receipt', Buffer.from('y'),'r.pdf').field('title','Test').field('amount','15');
  const id = draft.body.claim._id;
  await request(app).put(`/api/claims/${id}/submit`).set('Authorization',`Bearer ${employeeToken}`);
  await request(app).put(`/api/claims/${id}/approve`).set('Authorization',`Bearer ${managerToken}`);
  const finReject = await request(app).put(`/api/claims/${id}/reject-finance`).set('Authorization',`Bearer ${financeToken}`).send({ reason:'Invalid' });
  expect(finReject.status).toBe(200);
  expect(finReject.body.claim.status).toBe('rejected');
});
