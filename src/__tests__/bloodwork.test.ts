// Mock mongoose models before any app import
jest.mock('../models/BloodworkEntry', () => {
  const mockCreate = jest.fn();
  const mockFind = jest.fn();
  return {
    BloodworkEntry: {
      create: mockCreate,
      find: mockFind,
    },
  };
});

// Mock S3 storage (required by documents route imported via app)
jest.mock('../services/storage', () => ({
  uploadBlob: jest.fn(),
  getBlob: jest.fn(),
  deleteBlob: jest.fn(),
}));

// Mock mongoose models used by other routes
jest.mock('../models/Document', () => ({
  DocumentModel: { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), deleteOne: jest.fn() },
}));

jest.mock('../models/User', () => ({
  UserModel: { findById: jest.fn(), find: jest.fn(), updateOne: jest.fn() },
}));

jest.mock('../models/Share', () => ({
  ShareModel: { find: jest.fn(), findOne: jest.fn(), create: jest.fn() },
}));

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../app';
import { BloodworkEntry } from '../models/BloodworkEntry';

const JWT_SECRET = 'dev-secret';
const userId = '64f1234567890abcdef12345';

function makeToken(id: string): string {
  return jwt.sign({ sub: id }, JWT_SECRET, { expiresIn: '1h' });
}

const mockCreate = BloodworkEntry.create as jest.Mock;
const mockFind = BloodworkEntry.find as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// POST /api/bloodwork
// ---------------------------------------------------------------------------

describe('POST /api/bloodwork', () => {
  const token = makeToken(userId);
  const validBody = { date: '2025-06-15', marker: 'Vitamin D', value: 42.5, unit: 'ng/mL' };

  it('returns 401 without auth token', async () => {
    const res = await request(app).post('/api/bloodwork').send(validBody);
    expect(res.status).toBe(401);
  });

  it('returns 400 when date is missing', async () => {
    const { date: _d, ...body } = validBody;
    const res = await request(app)
      .post('/api/bloodwork')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when date format is invalid', async () => {
    const res = await request(app)
      .post('/api/bloodwork')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validBody, date: '15-06-2025' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/date/i);
  });

  it('returns 400 when marker is empty', async () => {
    const res = await request(app)
      .post('/api/bloodwork')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validBody, marker: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/marker/i);
  });

  it('returns 400 when value is not a number', async () => {
    const res = await request(app)
      .post('/api/bloodwork')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validBody, value: 'high' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/value/i);
  });

  it('returns 400 when unit is empty', async () => {
    const res = await request(app)
      .post('/api/bloodwork')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validBody, unit: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unit/i);
  });

  it('returns 201 and the saved entry on valid body', async () => {
    const fakeEntry = { _id: 'abc123', ...validBody, userId, createdAt: new Date() };
    mockCreate.mockResolvedValue(fakeEntry);

    const res = await request(app)
      .post('/api/bloodwork')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, data: expect.objectContaining({ marker: 'Vitamin D' }) });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      date: '2025-06-15',
      marker: 'Vitamin D',
      value: 42.5,
      unit: 'ng/mL',
    }));
  });

  it('returns 500 when db create throws', async () => {
    mockCreate.mockRejectedValue(new Error('db error'));

    const res = await request(app)
      .post('/api/bloodwork')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody);

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------------------
// GET /api/bloodwork
// ---------------------------------------------------------------------------

describe('GET /api/bloodwork', () => {
  const token = makeToken(userId);

  it('returns 401 without auth token', async () => {
    const res = await request(app).get('/api/bloodwork');
    expect(res.status).toBe(401);
  });

  it('returns all entries for the user sorted by date', async () => {
    const entries = [
      { _id: '1', userId, date: '2025-01-01', marker: 'Ferritin', value: 50, unit: 'μg/L' },
      { _id: '2', userId, date: '2025-03-01', marker: 'HbA1c', value: 5.4, unit: '%' },
    ];
    mockFind.mockReturnValue({ sort: jest.fn().mockResolvedValue(entries) });

    const res = await request(app)
      .get('/api/bloodwork')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: entries });
    expect(mockFind).toHaveBeenCalledWith({ userId });
  });

  it('filters by marker when ?marker= query param is provided', async () => {
    const entries = [
      { _id: '1', userId, date: '2025-01-01', marker: 'Vitamin D', value: 30, unit: 'ng/mL' },
    ];
    mockFind.mockReturnValue({ sort: jest.fn().mockResolvedValue(entries) });

    const res = await request(app)
      .get('/api/bloodwork?marker=Vitamin D')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(mockFind).toHaveBeenCalledWith({ userId, marker: 'Vitamin D' });
  });

  it('returns 500 when db query throws', async () => {
    mockFind.mockReturnValue({ sort: jest.fn().mockRejectedValue(new Error('db error')) });

    const res = await request(app)
      .get('/api/bloodwork')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });
});
