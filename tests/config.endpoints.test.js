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

describe('Config endpoints', () => {
  test('finance can update default limit and user limit', async () => {
    await register({ name:'Admin', email:'admin@example.com', password:'Secret123', role:'admin' });
    await register({ name:'Finance', email:'fin@example.com', password:'Secret123', role:'finance' });
    await register({ name:'Mgr', email:'mgr@example.com', password:'Secret123', role:'manager' });
    const mgrLogin = await login('mgr@example.com');
    const mgrId = mgrLogin.body.user._id;
    await register({ name:'Emp', email:'emp@example.com', password:'Secret123', role:'employee', manager: mgrId });
    const financeLogin = await login('fin@example.com');
    const finToken = financeLogin.body.token;

    // Update default limit
    const updDefault = await request(app).put('/api/config/default-limit').set(auth(finToken)).send({ defaultLimit: 750 });
    expect(updDefault.status).toBe(200);
    expect(updDefault.body.config.defaultClaimLimit).toBe(750);

    // Update user limit override
    const updUser = await request(app).put('/api/config/user-limit').set(auth(finToken)).send({ email: 'emp@example.com', limit: 600, used: 0 });
    expect(updUser.status).toBe(200);
    expect(updUser.body.user.claimLimit).toBe(600);
  });

  test('validation errors for bad payload', async () => {
    await register({ name:'Finance2', email:'fin2@example.com', password:'Secret123', role:'finance' });
    const finLogin = await login('fin2@example.com');
    const finToken = finLogin.body.token;
    const bad1 = await request(app).put('/api/config/default-limit').set(auth(finToken)).send({ defaultLimit: 0 });
    expect(bad1.status).toBe(400);
    const bad2 = await request(app).put('/api/config/user-limit').set(auth(finToken)).send({ email:'none@example.com', limit: 500, used:0 });
    expect(bad2.status).toBe(404);
  });
});
