const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
require('dotenv').config();
let app;
const User = require('../src/models/User');
// Config imported implicitly via user controller; no direct use here

let mongoServer;

async function createAndLogin(user) {
  const res = await request(app).post('/api/auth/register').send(user);
  return res.body.token;
}

describe('GET /api/users/:id/claim-limit', () => {
  beforeAll(async () => {
      mongoServer = await MongoMemoryServer.create();
      process.env.MONGO_URI = mongoServer.getUri();
      process.env.JWT_SECRET = 'testsecret';
      app = require('../src/app');
      await mongoose.connection.asPromise();
    });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  test('returns effective limit source=role when no override', async () => {
    const managerId = new mongoose.Types.ObjectId().toString();
    const token = await createAndLogin({
      name: 'Alice', email: 'a@example.com', password: 'Pass1234!', role: 'employee', manager: managerId
    });
    const user = await User.findOne({ email: 'a@example.com' });

    const res = await request(app)
      .get(`/api/users/${user._id}/claim-limit`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toHaveProperty('effectiveClaimLimit');
  // With no role-specific limit configured, expect default source
  expect(res.body.source).toBe('default');
    expect(res.body.userId).toBe(String(user._id));
  });

  test('returns override source when user has claimLimit set', async () => {
    const adminToken = await createAndLogin({
      name: 'Admin', email: 'admin@example.com', password: 'Pass1234!', role: 'admin'
    });
    const managerToken = await createAndLogin({
      name: 'Mgr', email: 'mgr@example.com', password: 'Pass1234!', role: 'manager'
    });
    const manager = await User.findOne({ email: 'mgr@example.com' });

    const employeeToken = await createAndLogin({
      name: 'Bob', email: 'bob@example.com', password: 'Pass1234!', role: 'employee', manager: manager._id.toString()
    });
    const employee = await User.findOne({ email: 'bob@example.com' });

    // set override
    await request(app)
      .patch(`/api/users/${employee._id}/limit`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ claimLimit: 1234 })
      .expect(200);

  const res = await request(app)
      .get(`/api/users/${employee._id}/claim-limit`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(200);

    expect(res.body.effectiveClaimLimit).toBe(1234);
    expect(res.body.source).toBe('override');
  });

  test('manager can view direct report claim limit; other users forbidden', async () => {
    const managerToken = await createAndLogin({
      name: 'Mgr2', email: 'mgr2@example.com', password: 'Pass1234!', role: 'manager'
    });
    const manager = await User.findOne({ email: 'mgr2@example.com' });

    const employeeToken = await createAndLogin({
      name: 'Eve', email: 'eve@example.com', password: 'Pass1234!', role: 'employee', manager: manager._id.toString()
    });
    const employee = await User.findOne({ email: 'eve@example.com' });

    const otherToken = await createAndLogin({
      name: 'Zed', email: 'zed@example.com', password: 'Pass1234!', role: 'employee', manager: manager._id.toString()
    });

    // manager can view
    await request(app)
      .get(`/api/users/${employee._id}/claim-limit`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);

    // other employee cannot
    await request(app)
      .get(`/api/users/${employee._id}/claim-limit`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);
  });

  test('finance can view any user limit', async () => {
    const finToken = await createAndLogin({
      name: 'Fin', email: 'fin@example.com', password: 'Pass1234!', role: 'finance'
    });

    const managerToken = await createAndLogin({
      name: 'Mgr3', email: 'mgr3@example.com', password: 'Pass1234!', role: 'manager'
    });
    const manager = await User.findOne({ email: 'mgr3@example.com' });

    const empToken = await createAndLogin({
      name: 'Ion', email: 'ion@example.com', password: 'Pass1234!', role: 'employee', manager: manager._id.toString()
    });
    const emp = await User.findOne({ email: 'ion@example.com' });

    const res = await request(app)
      .get(`/api/users/${emp._id}/claim-limit`)
      .set('Authorization', `Bearer ${finToken}`)
      .expect(200);

    expect(res.body).toHaveProperty('effectiveClaimLimit');
  });
});
