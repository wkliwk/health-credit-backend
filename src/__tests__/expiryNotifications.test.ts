import {
  computeFreshnessExpiresAt,
  getFreshnessWindowDays,
  isExpiringIn,
  runExpiryNotifications,
} from '../jobs/expiryNotifications';

// Mock web-push
jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn().mockResolvedValue({}),
}));

// Mock node-cron
jest.mock('node-cron', () => ({
  schedule: jest.fn(),
}));

// Mock models
jest.mock('../models/User', () => ({
  UserModel: {
    find: jest.fn(),
    updateOne: jest.fn(),
    findById: jest.fn(),
  },
}));

jest.mock('../models/Document', () => ({
  DocumentModel: {
    findOne: jest.fn(),
  },
  DOCUMENT_TYPES: ['STI_PANEL', 'HIV', 'STI_PARTIAL', 'HEPATITIS', 'VACCINE', 'BLOOD_WORK', 'OTHER'],
}));

// Mock push notification service
jest.mock('../services/pushNotification', () => ({
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
  getVapidPublicKey: jest.fn().mockReturnValue('BExamplePublicKey'),
}));

import { UserModel } from '../models/User';
import { DocumentModel } from '../models/Document';
import { sendPushNotification } from '../services/pushNotification';

const mockUserModel = UserModel as jest.Mocked<typeof UserModel>;
const mockDocumentModel = DocumentModel as jest.Mocked<typeof DocumentModel>;
const mockSendPushNotification = sendPushNotification as jest.MockedFunction<typeof sendPushNotification>;

describe('computeFreshnessExpiresAt', () => {
  const baseDate = new Date('2026-01-01T00:00:00.000Z');

  it('computes 90-day window for STI_PANEL', () => {
    const result = computeFreshnessExpiresAt(baseDate, 'STI_PANEL');
    expect(result.getTime()).toBe(baseDate.getTime() + 90 * 24 * 60 * 60 * 1000);
  });

  it('computes 90-day window for HIV', () => {
    const result = computeFreshnessExpiresAt(baseDate, 'HIV');
    expect(result.getTime()).toBe(baseDate.getTime() + 90 * 24 * 60 * 60 * 1000);
  });

  it('computes 90-day window for STI_PARTIAL', () => {
    const result = computeFreshnessExpiresAt(baseDate, 'STI_PARTIAL');
    expect(result.getTime()).toBe(baseDate.getTime() + 90 * 24 * 60 * 60 * 1000);
  });

  it('computes 180-day window for HEPATITIS', () => {
    const result = computeFreshnessExpiresAt(baseDate, 'HEPATITIS');
    expect(result.getTime()).toBe(baseDate.getTime() + 180 * 24 * 60 * 60 * 1000);
  });

  it('computes 365-day window for VACCINE', () => {
    const result = computeFreshnessExpiresAt(baseDate, 'VACCINE');
    expect(result.getTime()).toBe(baseDate.getTime() + 365 * 24 * 60 * 60 * 1000);
  });

  it('computes 180-day window for BLOOD_WORK', () => {
    const result = computeFreshnessExpiresAt(baseDate, 'BLOOD_WORK');
    expect(result.getTime()).toBe(baseDate.getTime() + 180 * 24 * 60 * 60 * 1000);
  });

  it('computes 180-day window for OTHER', () => {
    const result = computeFreshnessExpiresAt(baseDate, 'OTHER');
    expect(result.getTime()).toBe(baseDate.getTime() + 180 * 24 * 60 * 60 * 1000);
  });
});

describe('getFreshnessWindowDays', () => {
  it('returns correct window for each document type', () => {
    expect(getFreshnessWindowDays('STI_PANEL')).toBe(90);
    expect(getFreshnessWindowDays('HIV')).toBe(90);
    expect(getFreshnessWindowDays('STI_PARTIAL')).toBe(90);
    expect(getFreshnessWindowDays('HEPATITIS')).toBe(180);
    expect(getFreshnessWindowDays('VACCINE')).toBe(365);
    expect(getFreshnessWindowDays('BLOOD_WORK')).toBe(180);
    expect(getFreshnessWindowDays('OTHER')).toBe(180);
  });
});

describe('isExpiringIn', () => {
  const now = new Date('2026-01-15T09:00:00.000Z');

  it('returns true when expiry is exactly 7 days from now', () => {
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    expect(isExpiringIn(expiresAt, 7, now)).toBe(true);
  });

  it('returns true when expiry is within +12h of 7-day target', () => {
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000 + 11 * 60 * 60 * 1000);
    expect(isExpiringIn(expiresAt, 7, now)).toBe(true);
  });

  it('returns true when expiry is within -12h of 7-day target', () => {
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000 - 11 * 60 * 60 * 1000);
    expect(isExpiringIn(expiresAt, 7, now)).toBe(true);
  });

  it('returns false when expiry is more than 12h outside 7-day target', () => {
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000 + 13 * 60 * 60 * 1000);
    expect(isExpiringIn(expiresAt, 7, now)).toBe(false);
  });

  it('returns true when expiry is exactly 1 day from now', () => {
    const expiresAt = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
    expect(isExpiringIn(expiresAt, 1, now)).toBe(true);
  });

  it('returns false when expiry is not near target', () => {
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(isExpiringIn(expiresAt, 7, now)).toBe(false);
  });
});

describe('runExpiryNotifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends 7-day warning push notification when STI_PANEL expires in 7 days', async () => {
    const now = new Date();
    // STI_PANEL: 90-day window. Created 83 days ago => expires in 7 days.
    const createdAt = new Date(now.getTime() - 83 * 24 * 60 * 60 * 1000);

    const mockUser = {
      _id: 'user1',
      pushSubscription: {
        endpoint: 'https://push.example.com/sub/1',
        keys: { p256dh: 'key1', auth: 'auth1' },
      },
    };

    (mockUserModel.find as jest.Mock).mockResolvedValue([mockUser]);
    (mockDocumentModel.findOne as jest.Mock).mockImplementation(
      (_query: unknown, _projection: unknown) => ({
        sort: (_sortOrder: unknown) => Promise.resolve({ createdAt, documentType: 'STI_PANEL' }),
      }),
    );

    await runExpiryNotifications();

    expect(mockSendPushNotification).toHaveBeenCalledWith(
      mockUser.pushSubscription,
      expect.objectContaining({
        title: 'Your health docs expire in 7 days',
        url: '/wallet',
      }),
    );
  });

  it('sends 1-day warning push notification when STI_PANEL expires in 1 day', async () => {
    const now = new Date();
    // STI_PANEL: 90-day window. Created 89 days ago => expires in 1 day.
    const createdAt = new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000);

    const mockUser = {
      _id: 'user2',
      pushSubscription: {
        endpoint: 'https://push.example.com/sub/2',
        keys: { p256dh: 'key2', auth: 'auth2' },
      },
    };

    (mockUserModel.find as jest.Mock).mockResolvedValue([mockUser]);
    (mockDocumentModel.findOne as jest.Mock).mockImplementation(
      (_query: unknown, _projection: unknown) => ({
        sort: (_sortOrder: unknown) => Promise.resolve({ createdAt, documentType: 'STI_PANEL' }),
      }),
    );

    await runExpiryNotifications();

    expect(mockSendPushNotification).toHaveBeenCalledWith(
      mockUser.pushSubscription,
      expect.objectContaining({
        title: 'Your health docs expire tomorrow',
        url: '/wallet',
      }),
    );
  });

  it('does not send notification when no documents are expiring soon', async () => {
    const now = new Date();
    // Created 10 days ago — far from expiry
    const createdAt = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

    const mockUser = {
      _id: 'user3',
      pushSubscription: {
        endpoint: 'https://push.example.com/sub/3',
        keys: { p256dh: 'key3', auth: 'auth3' },
      },
    };

    (mockUserModel.find as jest.Mock).mockResolvedValue([mockUser]);
    (mockDocumentModel.findOne as jest.Mock).mockImplementation(
      (_query: unknown, _projection: unknown) => ({
        sort: (_sortOrder: unknown) => Promise.resolve({ createdAt, documentType: 'STI_PANEL' }),
      }),
    );

    await runExpiryNotifications();

    expect(mockSendPushNotification).not.toHaveBeenCalled();
  });

  it('does not send notifications when user has no push subscription', async () => {
    (mockUserModel.find as jest.Mock).mockResolvedValue([
      { _id: 'user4', pushSubscription: undefined },
    ]);

    await runExpiryNotifications();

    expect(mockSendPushNotification).not.toHaveBeenCalled();
    expect(mockDocumentModel.findOne).not.toHaveBeenCalled();
  });

  it('does not send notification when user has no documents', async () => {
    const mockUser = {
      _id: 'user5',
      pushSubscription: {
        endpoint: 'https://push.example.com/sub/5',
        keys: { p256dh: 'key5', auth: 'auth5' },
      },
    };

    (mockUserModel.find as jest.Mock).mockResolvedValue([mockUser]);
    (mockDocumentModel.findOne as jest.Mock).mockImplementation(
      (_query: unknown, _projection: unknown) => ({
        sort: (_sortOrder: unknown) => Promise.resolve(null),
      }),
    );

    await runExpiryNotifications();

    expect(mockSendPushNotification).not.toHaveBeenCalled();
  });
});
