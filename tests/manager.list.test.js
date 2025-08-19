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

test('list managers returns managers and employee registration without manager fails', async () => {
  // Seed two managers
  await request(app).post('/api/auth/register').send({ name:'MgrA', email:'mgrA@example.com', password:'Secret123', role:'manager' });
  await request(app).post('/api/auth/register').send({ name:'MgrB', email:'mgrB@example.com', password:'Secret123', role:'manager' });

  const listRes = await request(app).get('/api/users/managers');
  expect(listRes.status).toBe(200);
  expect(listRes.body.managers.length).toBe(2);

  // Attempt to register employee without manager -> 400
  const badEmp = await request(app).post('/api/auth/register').send({ name:'Emp', email:'emp@example.com', password:'Secret123', role:'employee' });
  expect(badEmp.status).toBe(400);
  expect(badEmp.body.message).toMatch(/manager/i);

  // Register employee with manager succeeds
  const goodEmp = await request(app).post('/api/auth/register').send({ name:'Emp', email:'emp2@example.com', password:'Secret123', role:'employee', manager: listRes.body.managers[0]._id });
  expect(goodEmp.status).toBe(201);
});
