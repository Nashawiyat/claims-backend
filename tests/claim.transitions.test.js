const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');
require('dotenv').config();

let app;
let mongo;

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

async function registerAndLogin(user) {
  await request(app).post('/api/auth/register').send(user);
  const res = await request(app).post('/api/auth/login').send({ email: user.email, password: user.password });
  return res.body.token;
}

async function createEmployeeWithManager(empName, empEmail, managerId) {
  await request(app).post('/api/auth/register').send({ name: empName, email: empEmail, password: 'Secret123', role: 'employee', manager: managerId });
  const res = await request(app).post('/api/auth/login').send({ email: empEmail, password: 'Secret123' });
  return res.body.token;
}

test('employee draft -> submit -> manager approve -> finance reimburse', async () => {
  // Create manager and finance first
  await request(app).post('/api/auth/register').send({ name: 'Mgr', email: 'mgr@example.com', password: 'Secret123', role: 'manager' });
  const managerLogin = await request(app).post('/api/auth/login').send({ email: 'mgr@example.com', password: 'Secret123' });
  const managerToken = managerLogin.body.token;
  const managerId = managerLogin.body.user._id;
  const financeToken = await registerAndLogin({ name: 'Fin', email: 'fin@example.com', password: 'Secret123', role: 'finance' });
  const employeeToken = await createEmployeeWithManager('Emp','emp@example.com', managerId);

  // Create draft (mock receipt upload via attach)
  const draftRes = await request(app)
    .post('/api/claims')
    .set('Authorization', `Bearer ${employeeToken}`)
    .attach('receipt', Buffer.from('dummy'), 'receipt.pdf')
    .field('title', 'Lunch')
    .field('amount', '12.5');
  expect(draftRes.status).toBe(201);
  const claimId = draftRes.body.claim._id;

  // Submit
  const submitRes = await request(app)
    .put(`/api/claims/${claimId}/submit`)
    .set('Authorization', `Bearer ${employeeToken}`);
  expect(submitRes.status).toBe(200);
  expect(submitRes.body.claim.status).toBe('submitted');

  // Approve (manager)
  const approveRes = await request(app)
    .put(`/api/claims/${claimId}/approve`)
    .set('Authorization', `Bearer ${managerToken}`);
  expect(approveRes.status).toBe(200);
  expect(approveRes.body.claim.status).toBe('approved');

  // Reimburse (finance)
  const reimburseRes = await request(app)
    .put(`/api/claims/${claimId}/reimburse`)
    .set('Authorization', `Bearer ${financeToken}`);
  expect(reimburseRes.status).toBe(200);
  expect(reimburseRes.body.claim.status).toBe('reimbursed');
});

test('draft -> submit -> manager reject path; finance cannot reimburse rejected; manager cannot approve twice', async () => {
  await request(app).post('/api/auth/register').send({ name: 'Mgr2', email: 'mgr2@example.com', password: 'Secret123', role: 'manager' });
  const mgrLogin = await request(app).post('/api/auth/login').send({ email: 'mgr2@example.com', password: 'Secret123' });
  const managerToken = mgrLogin.body.token; const managerId = mgrLogin.body.user._id;
  const financeToken = await registerAndLogin({ name: 'Fin2', email: 'fin2@example.com', password: 'Secret123', role: 'finance' });
  const employeeToken = await createEmployeeWithManager('Emp2','emp2@example.com', managerId);

  // Create draft
  const draftRes = await request(app)
    .post('/api/claims')
    .set('Authorization', `Bearer ${employeeToken}`)
    .attach('receipt', Buffer.from('dummy'), 'receipt2.pdf')
    .field('title', 'Taxi')
    .field('amount', '30');
  expect(draftRes.status).toBe(201);
  const claimId = draftRes.body.claim._id;

  // Submit
  const submitRes = await request(app)
    .put(`/api/claims/${claimId}/submit`)
    .set('Authorization', `Bearer ${employeeToken}`);
  expect(submitRes.status).toBe(200);
  expect(submitRes.body.claim.status).toBe('submitted');

  // Reject
  const rejectRes = await request(app)
    .put(`/api/claims/${claimId}/reject`)
    .set('Authorization', `Bearer ${managerToken}`)
    .send({ reason: 'Not valid' });
  expect(rejectRes.status).toBe(200);
  expect(rejectRes.body.claim.status).toBe('rejected');

  // Finance attempt to reimburse rejected claim -> 400
  const reimburseRejected = await request(app)
    .put(`/api/claims/${claimId}/reimburse`)
    .set('Authorization', `Bearer ${financeToken}`);
  expect(reimburseRejected.status).toBe(400);

  // Manager cannot approve rejected (not submitted) -> 400
  const approveRejected = await request(app)
    .put(`/api/claims/${claimId}/approve`)
    .set('Authorization', `Bearer ${managerToken}`);
  expect(approveRejected.status).toBe(400);
});

test('forbidden and invalid transitions: employee cannot approve; cannot approve draft; cannot reimburse submitted', async () => {
  await request(app).post('/api/auth/register').send({ name: 'Mgr3', email: 'mgr3@example.com', password: 'Secret123', role: 'manager' });
  const mgrLogin = await request(app).post('/api/auth/login').send({ email: 'mgr3@example.com', password: 'Secret123' });
  const managerToken = mgrLogin.body.token; const managerId = mgrLogin.body.user._id;
  const financeToken = await registerAndLogin({ name: 'Fin3', email: 'fin3@example.com', password: 'Secret123', role: 'finance' });
  const employeeToken = await createEmployeeWithManager('Emp3','emp3@example.com', managerId);

  // Draft
  const draftRes = await request(app)
    .post('/api/claims')
    .set('Authorization', `Bearer ${employeeToken}`)
    .attach('receipt', Buffer.from('dummy'), 'receipt3.pdf')
    .field('title', 'Hotel')
    .field('amount', '100');
  const claimId = draftRes.body.claim._id;
  expect(draftRes.status).toBe(201);

  // Employee tries to approve -> 403
  const employeeApprove = await request(app)
    .put(`/api/claims/${claimId}/approve`)
    .set('Authorization', `Bearer ${employeeToken}`);
  expect(employeeApprove.status).toBe(403);

  // Manager tries to approve draft (not submitted) -> 400
  const managerApproveDraft = await request(app)
    .put(`/api/claims/${claimId}/approve`)
    .set('Authorization', `Bearer ${managerToken}`);
  expect(managerApproveDraft.status).toBe(400);

  // Submit
  const submitRes = await request(app)
    .put(`/api/claims/${claimId}/submit`)
    .set('Authorization', `Bearer ${employeeToken}`);
  expect(submitRes.status).toBe(200);
  expect(submitRes.body.claim.status).toBe('submitted');

  // Finance tries to reimburse submitted (not approved) -> 400
  const financeReimburseEarly = await request(app)
    .put(`/api/claims/${claimId}/reimburse`)
    .set('Authorization', `Bearer ${financeToken}`);
  expect(financeReimburseEarly.status).toBe(400);
});

test('employee cannot submit someone else\'s draft', async () => {
  await request(app).post('/api/auth/register').send({ name: 'Mgr4', email: 'mgr4@example.com', password: 'Secret123', role: 'manager' });
  const mgrLogin = await request(app).post('/api/auth/login').send({ email: 'mgr4@example.com', password: 'Secret123' });
  const managerId = mgrLogin.body.user._id;
  const employee1Token = await (async ()=>{await request(app).post('/api/auth/register').send({ name: 'Emp4A', email: 'emp4a@example.com', password: 'Secret123', role: 'employee', manager: managerId }); const l= await request(app).post('/api/auth/login').send({ email: 'emp4a@example.com', password: 'Secret123' }); return l.body.token;})();
  const employee2Token = await (async ()=>{await request(app).post('/api/auth/register').send({ name: 'Emp4B', email: 'emp4b@example.com', password: 'Secret123', role: 'employee', manager: managerId }); const l= await request(app).post('/api/auth/login').send({ email: 'emp4b@example.com', password: 'Secret123' }); return l.body.token;})();
  const draftRes = await request(app)
    .post('/api/claims')
    .set('Authorization', `Bearer ${employee1Token}`)
    .attach('receipt', Buffer.from('dummy'), 'receipt4.pdf')
    .field('title', 'Taxi2')
    .field('amount', '15');
  expect(draftRes.status).toBe(201);
  const claimId = draftRes.body.claim._id;

  const submitOther = await request(app)
    .put(`/api/claims/${claimId}/submit`)
    .set('Authorization', `Bearer ${employee2Token}`);
  expect(submitOther.status).toBe(403);
});
