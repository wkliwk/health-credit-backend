import request from 'supertest';
import jwt from 'jsonwebtoken';

// Mock web-push before importing app
jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn().mockResolvedValue({}),
}));

// Mock node-cron to prevent actual scheduling in tests
jest.mock('node-cron', () => ({
  schedule: jest.fn(),
}));

// Mock mongoose models to avoid real DB connections
jest.mock('../models/User', () => ({
  UserModel: {
    findById: jest.fn(),
    find: jest.fn(),
    updateOne: jest.fn(),
  },
}));

jest.mock('../models/Document', () => ({
  DocumentModel: {
    findOne: jest.fn(),
  },
  DOCUMENT_TYPES: ['STI_PANEL', 'HIV', 'STI_PARTIAL', 'HEPATITIS', 'VACCINE', 'BLOOD_WORK', 'OTHER'],
}));

// Mock S3 storage
jest.mock('../services/storage', () => ({
  uploadBlob: jest.fn(),
  getBlob: jest.fn(),
  deleteBlob: jest.fn(),
}));

import { app } from '../app';
import { UserModel } from '../models/User';

const JWT_SECRET = 'test-secret';

function makeToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '1h' });
}

const mockUserModel = UserModel as jest.Mocked<typeof UserModel>;

describe('GET /api/push/vapid-public-key', () => {
  it('returns the VAPID public key without auth', async () => {
    const res = await request(app).get('/api/push/vapid-public-key');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('publicKey', 'BExamplePublicKey');
  });

  it('returns 503 if VAPID key is not configured', async () => {
    const original = process.env.VAPID_PUBLIC_KEY;
    process.env.VAPID_PUBLIC_KEY = '';
    const res = await request(app).get('/api/push/vapid-public-key');
    expect(res.status).toBe(503);
    process.env.VAPID_PUBLIC_KEY = original;
  });
});

describe('POST /api/push/subscribe', () => {
  const userId = '64f1234567890abcdef12345';
  const token = makeToken(userId);

  const validBody = {
    endpoint: 'https://push.example.com/sub/abc123',
    keys: {
      p256dh: 'base64_p256dh_key',
      auth: 'base64_auth_key',
    },
  };

  it('returns 401 without auth token', async () => {
    const res = await request(app).post('/api/push/subscribe').send(validBody);
    expect(res.status).toBe(401);
  });

  it('returns 400 if endpoint is missing', async () => {
    const res = await request(app)
      .post('/api/push/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({ keys: validBody.keys });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 if keys are missing', async () => {
    const res = await request(app)
      .post('/api/push/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({ endpoint: validBody.endpoint });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 201 on new subscription', async () => {
    const mockUser = {
      _id: userId,
      pushSubscription: undefined,
      save: jest.fn().mockResolvedValue(undefined),
    };
    (mockUserModel.findById as jest.Mock).mockResolvedValue(mockUser);

    const res = await request(app)
      .post('/api/push/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true });
    expect(mockUser.save).toHaveBeenCalled();
  });

  it('returns 200 when same endpoint already subscribed (idempotent)', async () => {
    const mockUser = {
      _id: userId,
      pushSubscription: { endpoint: validBody.endpoint, keys: validBody.keys },
      save: jest.fn().mockResolvedValue(undefined),
    };
    (mockUserModel.findById as jest.Mock).mockResolvedValue(mockUser);

    const res = await request(app)
      .post('/api/push/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  it('returns 404 if user not found', async () => {
    (mockUserModel.findById as jest.Mock).mockResolvedValue(null);

    const res = await request(app)
      .post('/api/push/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody);

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/push/subscribe', () => {
  const userId = '64f1234567890abcdef12345';
  const token = makeToken(userId);

  it('returns 401 without auth token', async () => {
    const res = await request(app).delete('/api/push/subscribe');
    expect(res.status).toBe(401);
  });

  it('returns 204 and clears subscription', async () => {
    const mockUser = {
      _id: userId,
      pushSubscription: { endpoint: 'https://push.example.com/sub/abc123', keys: {} },
    };
    (mockUserModel.findById as jest.Mock).mockResolvedValue(mockUser);
    (mockUserModel.updateOne as jest.Mock).mockResolvedValue({ modifiedCount: 1 });

    const res = await request(app)
      .delete('/api/push/subscribe')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(204);
    expect(mockUserModel.updateOne).toHaveBeenCalledWith(
      { _id: userId },
      { $unset: { pushSubscription: '' } },
    );
  });

  it('returns 404 if user not found', async () => {
    (mockUserModel.findById as jest.Mock).mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/push/subscribe')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});
