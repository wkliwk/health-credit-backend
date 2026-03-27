// Mock S3 storage before any app imports so the module is replaced everywhere
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
import { app } from '../app';
import { connectTestDB, closeTestDB, clearCollections, createTestUser } from './setup';
import { uploadBlob } from '../services/storage';

const mockedUploadBlob = uploadBlob as jest.MockedFunction<typeof uploadBlob>;

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

describe('GET /api/documents', () => {
  it('returns 401 when no token is supplied', async () => {
    const res = await request(app).get('/api/documents');
    expect(res.status).toBe(401);
  });

  it('returns an empty array when the user has no documents', async () => {
    const { token } = await createTestUser();

    const res = await request(app)
      .get('/api/documents')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  it('returns only documents belonging to the authenticated user', async () => {
    const user1 = await createTestUser('user1@example.com');
    const user2 = await createTestUser('user2@example.com');

    // Upload a document as user1
    await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${user1.token}`)
      .field('salt', 'aabbccdd')
      .field('iv', '11223344')
      .attach('file', Buffer.from('encrypted'), { filename: 'test.bin', contentType: 'application/octet-stream' });

    // user2 should see zero documents
    const res = await request(app)
      .get('/api/documents')
      .set('Authorization', `Bearer ${user2.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('does not return s3Key in the response (security — internal reference)', async () => {
    const { token } = await createTestUser();

    await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .field('salt', 'aabbccdd')
      .field('iv', '11223344')
      .attach('file', Buffer.from('encrypted'), { filename: 'doc.bin', contentType: 'application/octet-stream' });

    const res = await request(app)
      .get('/api/documents')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body[0].s3Key).toBeUndefined();
  });
});

describe('POST /api/documents (upload)', () => {
  it('returns 401 when no token is supplied', async () => {
    const res = await request(app)
      .post('/api/documents')
      .field('salt', 'aabbccdd')
      .field('iv', '11223344')
      .attach('file', Buffer.from('encrypted'), { filename: 'doc.bin', contentType: 'application/octet-stream' });

    expect(res.status).toBe(401);
  });

  it('returns 400 when no file is attached', async () => {
    const { token } = await createTestUser();

    const res = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({ salt: 'aabbccdd', iv: '11223344' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no file/i);
  });

  it('returns 400 when encryption salt is missing', async () => {
    const { token } = await createTestUser();

    const res = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .field('iv', '11223344')
      .attach('file', Buffer.from('encrypted'), { filename: 'doc.bin', contentType: 'application/octet-stream' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/salt/i);
  });

  it('returns 400 when encryption IV is missing', async () => {
    const { token } = await createTestUser();

    const res = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .field('salt', 'aabbccdd')
      .attach('file', Buffer.from('encrypted'), { filename: 'doc.bin', contentType: 'application/octet-stream' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/iv/i);
  });

  it('returns 201 and persists encryption metadata (salt and IV) on valid upload', async () => {
    const { token } = await createTestUser();

    const res = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .field('salt', 'mysalt123')
      .field('iv', 'myiv456')
      .attach('file', Buffer.from('encrypted-payload'), { filename: 'results.bin', contentType: 'application/octet-stream' });

    expect(res.status).toBe(201);
    expect(res.body.encryptionSalt).toBe('mysalt123');
    expect(res.body.encryptionIV).toBe('myiv456');
    expect(res.body.id).toBeDefined();
    expect(res.body.fileName).toBe('results.bin');
  });

  it('calls the storage service once per upload', async () => {
    const { token } = await createTestUser();

    await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .field('salt', 'aabbccdd')
      .field('iv', '11223344')
      .attach('file', Buffer.from('encrypted'), { filename: 'doc.bin', contentType: 'application/octet-stream' });

    expect(mockedUploadBlob).toHaveBeenCalledTimes(1);
  });

  it('does not expose the s3Key in the upload response', async () => {
    const { token } = await createTestUser();

    const res = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .field('salt', 'aabbccdd')
      .field('iv', '11223344')
      .attach('file', Buffer.from('encrypted'), { filename: 'doc.bin', contentType: 'application/octet-stream' });

    expect(res.status).toBe(201);
    expect(res.body.s3Key).toBeUndefined();
  });

  it('persists document and it appears in subsequent list call', async () => {
    const { token } = await createTestUser();

    await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .field('salt', 'salt1')
      .field('iv', 'iv1')
      .attach('file', Buffer.from('data'), { filename: 'file1.bin', contentType: 'application/octet-stream' });

    await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .field('salt', 'salt2')
      .field('iv', 'iv2')
      .attach('file', Buffer.from('data'), { filename: 'file2.bin', contentType: 'application/octet-stream' });

    const listRes = await request(app)
      .get('/api/documents')
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(2);
  });

  it('accepts optional retentionDays and stores an expiresAt date', async () => {
    const { token } = await createTestUser();

    const res = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .field('salt', 'aabbccdd')
      .field('iv', '11223344')
      .field('retentionDays', '30')
      .attach('file', Buffer.from('data'), { filename: 'doc.bin', contentType: 'application/octet-stream' });

    expect(res.status).toBe(201);
    expect(res.body.expiresAt).toBeDefined();

    const expiresAt = new Date(res.body.expiresAt);
    const now = new Date();
    const diffDays = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    // Allow small clock skew — should be close to 30 days
    expect(diffDays).toBeGreaterThan(29);
    expect(diffDays).toBeLessThan(31);
  });
});

describe('DELETE /api/documents/:id', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).delete('/api/documents/nonexistentid');
    expect(res.status).toBe(401);
  });

  it('returns 404 when document does not belong to the user', async () => {
    const owner = await createTestUser('owner@example.com');
    const attacker = await createTestUser('attacker@example.com');

    const uploadRes = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${owner.token}`)
      .field('salt', 'aabbccdd')
      .field('iv', '11223344')
      .attach('file', Buffer.from('data'), { filename: 'doc.bin', contentType: 'application/octet-stream' });

    const docId = uploadRes.body.id;

    const res = await request(app)
      .delete(`/api/documents/${docId}`)
      .set('Authorization', `Bearer ${attacker.token}`);

    expect(res.status).toBe(404);
  });

  it('returns 204 and removes the document on valid delete', async () => {
    const { token } = await createTestUser();

    const uploadRes = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .field('salt', 'aabbccdd')
      .field('iv', '11223344')
      .attach('file', Buffer.from('data'), { filename: 'doc.bin', contentType: 'application/octet-stream' });

    const docId = uploadRes.body.id;

    const deleteRes = await request(app)
      .delete(`/api/documents/${docId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(deleteRes.status).toBe(204);

    // Document no longer appears in list
    const listRes = await request(app)
      .get('/api/documents')
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.body).toHaveLength(0);
  });
});
