import request from 'supertest';
import { app } from '../app';
import { connectTestDB, closeTestDB, clearCollections } from './setup';

beforeAll(async () => {
  await connectTestDB();
});

afterAll(async () => {
  await closeTestDB();
});

afterEach(async () => {
  await clearCollections();
});

describe('POST /api/auth/register', () => {
  it('returns 201 and a JWT when credentials are valid', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'alice@example.com', password: 'password123' });

    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(10);
    expect(res.body.user.email).toBe('alice@example.com');
  });

  it('returns 409 when email is already registered', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'duplicate@example.com', password: 'password123' });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'duplicate@example.com', password: 'password123' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already registered/i);
  });

  it('returns 400 when email is missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ password: 'password123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  it('returns 400 when email format is invalid', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: 'password123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  it('returns 400 when password is shorter than 8 characters', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'short@example.com', password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password/i);
  });

  it('normalises email to lowercase before storing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'MiXeD@Example.COM', password: 'password123' });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('mixed@example.com');
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'logintest@example.com', password: 'password123' });
  });

  it('returns 200 and a JWT with valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'logintest@example.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(10);
    expect(res.body.user.email).toBe('logintest@example.com');
  });

  it('returns 401 when password is wrong', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'logintest@example.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);
  });

  it('returns 401 when email does not exist', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'password123' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);
  });

  it('returns 400 when body fields are missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'logintest@example.com' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('does not leak whether an email exists (same error for wrong email and wrong password)', async () => {
    const wrongEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@example.com', password: 'password123' });

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'logintest@example.com', password: 'wrongpassword' });

    // Both should return 401 with the same generic message
    expect(wrongEmail.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(wrongEmail.body.error).toBe(wrongPassword.body.error);
  });
});

describe('GET /api/auth/me', () => {
  it('returns 200 with current user info when token is valid', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: 'me@example.com', password: 'password123' });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${reg.body.token}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('me@example.com');
    // passwordHash must never be exposed
    expect(res.body.passwordHash).toBeUndefined();
  });

  it('returns 401 when no token is supplied', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});
