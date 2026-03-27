// Set test environment variables before any modules are loaded
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.MONGODB_URI = 'mongodb://localhost:27017/health-credit-test';
process.env.VAPID_PUBLIC_KEY = 'BExamplePublicKey';
process.env.VAPID_PRIVATE_KEY = 'ExamplePrivateKey';
process.env.VAPID_EMAIL = 'hello@healthcredit.app';
