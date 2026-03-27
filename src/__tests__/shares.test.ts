// Mock S3 storage before any app imports
jest.mock('../services/storage', () => ({
  uploadBlob: jest.fn().mockResolvedValue('documents/test-key-123'),
  getBlob: jest.fn().mockResolvedValue({
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from('encrypted-blob-data'));
        controller.close();
      },
    }),
    contentType: 'application/octet-stream',
  }),
  deleteBlob: jest.fn().mockResolvedValue(undefined),
}));

import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../app';
import { connectTestDB, closeTestDB, clearCollections, createTestUser } from './setup';
import { ShareModel } from '../models/Share';

beforeAll(async () => {
  await connectTestDB();
});

afterAll(async () => {
  await closeTestDB();
});

afterEach(async () => {
  await clearCollections();
  jest.clearAllMocks();
});

/**
 * Upload a document and return its ID. Helper to reduce boilerplate in share tests.
 */
async function uploadDocument(token: string): Promise<string> {
  const res = await request(app)
    .post('/api/documents')
    .set('Authorization', `Bearer ${token}`)
    .field('salt', 'testsalt')
    .field('iv', 'testiv')
    .attach('file', Buffer.from('encrypted-data'), { filename: 'doc.bin', contentType: 'application/octet-stream' });

  if (res.status !== 201) {
    throw new Error(`uploadDocument failed: ${JSON.stringify(res.body)}`);
  }

  return res.body.id as string;
}

describe('POST /api/shares (create share link)', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/shares')
      .send({ documentIds: ['fakeid'], expiry: '24h' });

    expect(res.status).toBe(401);
  });

  it('returns 400 when documentIds is empty', async () => {
    const { token } = await createTestUser();

    const res = await request(app)
      .post('/api/shares')
      .set('Authorization', `Bearer ${token}`)
      .send({ documentIds: [], expiry: '24h' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/documentIds/i);
  });

  it('returns 400 when expiry value is invalid', async () => {
    const { token } = await createTestUser();
    const docId = await uploadDocument(token);

    const res = await request(app)
      .post('/api/shares')
      .set('Authorization', `Bearer ${token}`)
      .send({ documentIds: [docId], expiry: '99y' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expiry/i);
  });

  it('returns 400 when a documentId does not belong to the user', async () => {
    const user1 = await createTestUser('shareowner@example.com');
    const user2 = await createTestUser('shareattacker@example.com');

    const docId = await uploadDocument(user1.token);

    const res = await request(app)
      .post('/api/shares')
      .set('Authorization', `Bearer ${user2.token}`)
      .send({ documentIds: [docId], expiry: '24h' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not found or not owned/i);
  });

  it('returns 201 with a share token and URL on valid request', async () => {
    const { token } = await createTestUser();
    const docId = await uploadDocument(token);

    const res = await request(app)
      .post('/api/shares')
      .set('Authorization', `Bearer ${token}`)
      .send({ documentIds: [docId], expiry: '24h' });

    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(8);
    expect(res.body.url).toContain(res.body.token);
    expect(res.body.expiresAt).toBeDefined();
  });

  it('creates share with maxViews when provided', async () => {
    const { token } = await createTestUser();
    const docId = await uploadDocument(token);

    const res = await request(app)
      .post('/api/shares')
      .set('Authorization', `Bearer ${token}`)
      .send({ documentIds: [docId], expiry: '24h', maxViews: 5 });

    expect(res.status).toBe(201);
    expect(res.body.maxViews).toBe(5);
  });
});

describe('GET /api/shares/:token (access share — public)', () => {
  it('returns 200 with document metadata on valid share token', async () => {
    const { token } = await createTestUser();
    const docId = await uploadDocument(token);

    const shareRes = await request(app)
      .post('/api/shares')
      .set('Authorization', `Bearer ${token}`)
      .send({ documentIds: [docId], expiry: '24h' });

    const shareToken = shareRes.body.token;

    const accessRes = await request(app).get(`/api/shares/${shareToken}`);

    expect(accessRes.status).toBe(200);
    expect(Array.isArray(accessRes.body.documents)).toBe(true);
    expect(accessRes.body.documents).toHaveLength(1);
    expect(accessRes.body.documents[0].encryptionSalt).toBeDefined();
    expect(accessRes.body.documents[0].encryptionIV).toBeDefined();
  });

  it('returns 404 when share token does not exist', async () => {
    const res = await request(app).get('/api/shares/nonexistent-token-xyz');
    expect(res.status).toBe(404);
  });

  it('returns 410 when share link has expired', async () => {
    const { token, userId } = await createTestUser();
    const docId = await uploadDocument(token);

    // Create a share that is already expired
    await ShareModel.create({
      userId,
      documentIds: [new mongoose.Types.ObjectId(docId)],
      expiresAt: new Date(Date.now() - 1000), // 1 second in the past
      maxViews: null,
    });

    // Retrieve the share to get its token
    const shares = await ShareModel.find({ userId });
    const expiredShare = shares[0];

    const res = await request(app).get(`/api/shares/${expiredShare.token}`);
    expect(res.status).toBe(410);
    expect(res.body.error).toMatch(/expired/i);
  });

  it('increments viewCount on each successful access', async () => {
    const { token } = await createTestUser();
    const docId = await uploadDocument(token);

    const shareRes = await request(app)
      .post('/api/shares')
      .set('Authorization', `Bearer ${token}`)
      .send({ documentIds: [docId], expiry: '24h' });

    const shareToken = shareRes.body.token;

    await request(app).get(`/api/shares/${shareToken}`);
    const secondAccess = await request(app).get(`/api/shares/${shareToken}`);

    expect(secondAccess.body.viewCount).toBe(2);
  });

  it('enforces maxViews — 3rd access fails when maxViews is 2', async () => {
    const { token } = await createTestUser();
    const docId = await uploadDocument(token);

    const shareRes = await request(app)
      .post('/api/shares')
      .set('Authorization', `Bearer ${token}`)
      .send({ documentIds: [docId], expiry: '24h', maxViews: 2 });

    const shareToken = shareRes.body.token;

    const first = await request(app).get(`/api/shares/${shareToken}`);
    const second = await request(app).get(`/api/shares/${shareToken}`);
    const third = await request(app).get(`/api/shares/${shareToken}`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(410);
    expect(third.body.error).toMatch(/maximum views/i);
  });

  it('does not expose s3Key or userId in the public share response', async () => {
    const { token } = await createTestUser();
    const docId = await uploadDocument(token);

    const shareRes = await request(app)
      .post('/api/shares')
      .set('Authorization', `Bearer ${token}`)
      .send({ documentIds: [docId], expiry: '24h' });

    const accessRes = await request(app).get(`/api/shares/${shareRes.body.token}`);

    expect(accessRes.status).toBe(200);
    const doc = accessRes.body.documents[0];
    expect(doc.s3Key).toBeUndefined();
    expect(doc.userId).toBeUndefined();
  });
});

describe('DELETE /api/shares/:id (revoke share)', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .delete('/api/shares/fakeid')
      .send();

    expect(res.status).toBe(401);
  });

  it('returns 204 and removes the share on valid revoke', async () => {
    const { token } = await createTestUser();
    const docId = await uploadDocument(token);

    const shareRes = await request(app)
      .post('/api/shares')
      .set('Authorization', `Bearer ${token}`)
      .send({ documentIds: [docId], expiry: '24h' });

    const shareId = shareRes.body.id;
    const shareToken = shareRes.body.token;

    const revokeRes = await request(app)
      .delete(`/api/shares/${shareId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(revokeRes.status).toBe(204);

    // Accessing the revoked share now returns 404
    const accessRes = await request(app).get(`/api/shares/${shareToken}`);
    expect(accessRes.status).toBe(404);
  });

  it('returns 404 when the share does not belong to the authenticated user', async () => {
    const owner = await createTestUser('revoke-owner@example.com');
    const attacker = await createTestUser('revoke-attacker@example.com');

    const docId = await uploadDocument(owner.token);

    const shareRes = await request(app)
      .post('/api/shares')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ documentIds: [docId], expiry: '24h' });

    const res = await request(app)
      .delete(`/api/shares/${shareRes.body.id}`)
      .set('Authorization', `Bearer ${attacker.token}`);

    expect(res.status).toBe(404);
  });
});

describe('GET /api/shares (list user shares)', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/shares');
    expect(res.status).toBe(401);
  });

  it('returns only active (non-expired) shares for the current user', async () => {
    const { token, userId } = await createTestUser();
    const docId = await uploadDocument(token);

    // Create one active share via the API
    await request(app)
      .post('/api/shares')
      .set('Authorization', `Bearer ${token}`)
      .send({ documentIds: [docId], expiry: '24h' });

    // Directly insert an expired share for the same user
    await ShareModel.create({
      userId,
      documentIds: [new mongoose.Types.ObjectId(docId)],
      expiresAt: new Date(Date.now() - 1000),
      maxViews: null,
    });

    const res = await request(app)
      .get('/api/shares')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // Only the active share should appear
    expect(res.body).toHaveLength(1);
  });
});
