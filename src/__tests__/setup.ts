import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { app } from '../app';

let mongoServer: MongoMemoryServer;

/**
 * Starts in-memory MongoDB before the full test suite.
 * Each test file imports this setup via jest globalSetup is not used here —
 * instead each test suite calls connectTestDB / closeTestDB directly.
 */
export async function connectTestDB(): Promise<void> {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
}

export async function closeTestDB(): Promise<void> {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongoServer.stop();
}

export async function clearCollections(): Promise<void> {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
}

/**
 * Registers a test user and returns their JWT token.
 * Uses a unique email suffix to avoid cross-test conflicts.
 */
export async function createTestUser(
  email = `testuser_${Date.now()}@example.com`,
  password = 'password123',
): Promise<{ token: string; userId: string; email: string }> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password });

  if (res.status !== 201) {
    throw new Error(`createTestUser failed: ${JSON.stringify(res.body)}`);
  }

  return {
    token: res.body.token as string,
    userId: res.body.user.id as string,
    email: res.body.user.email as string,
  };
}
