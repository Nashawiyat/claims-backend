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

describe('Get user and manager APIs', () => {
  test('employee can get self and manager details; unauthorized access blocked', async () => {
    // create manager and employee
    await register({ name:'Mgr', email:'mgr@get.test', password:'Secret123', role:'manager' });
    const mgrLogin = await login('mgr@get.test');
    const managerId = mgrLogin.body.user._id;

    await register({ name:'Emp', email:'emp@get.test', password:'Secret123', role:'employee', manager: managerId });
    const empLogin = await login('emp@get.test');
    const employeeId = empLogin.body.user._id;

    // self fetch
    const selfRes = await request(app).get(`/api/users/${employeeId}`).set(auth(empLogin.body.token));
    expect(selfRes.status).toBe(200);
    expect(selfRes.body.user.email).toBe('emp@get.test');

    // manager fetch by employee
    const mgrRes = await request(app).get(`/api/users/${employeeId}/manager`).set(auth(empLogin.body.token));
    expect(mgrRes.status).toBe(200);
    expect(mgrRes.body.manager.email).toBe('mgr@get.test');

    // another employee should not access first employee
    await register({ name:'Emp2', email:'emp2@get.test', password:'Secret123', role:'employee', manager: managerId });
    const emp2Login = await login('emp2@get.test');
    const forbidden = await request(app).get(`/api/users/${employeeId}`).set(auth(emp2Login.body.token));
    expect(forbidden.status).toBe(403);
  });

  test('admin can fetch any user and employee manager', async () => {
    await register({ name:'Mgr2', email:'mgr2@get.test', password:'Secret123', role:'manager' });
    const mgr2Login = await login('mgr2@get.test');
    const manager2Id = mgr2Login.body.user._id;

    await register({ name:'EmpA', email:'empa@get.test', password:'Secret123', role:'employee', manager: manager2Id });
    const empALogin = await login('empa@get.test');

    await register({ name:'Admin', email:'admin@get.test', password:'Secret123', role:'admin' });
    const adminLogin = await login('admin@get.test');

    const userRes = await request(app).get(`/api/users/${empALogin.body.user._id}`).set(auth(adminLogin.body.token));
    expect(userRes.status).toBe(200);
    const mgrRes = await request(app).get(`/api/users/${empALogin.body.user._id}/manager`).set(auth(adminLogin.body.token));
    expect(mgrRes.status).toBe(200);
  });
});
