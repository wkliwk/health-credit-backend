// Test the pushNotification service directly — especially 410 Gone handling.
// This file mocks web-push but does NOT mock the service itself.

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

jest.mock('node-cron', () => ({
  schedule: jest.fn(),
}));

jest.mock('../models/User', () => ({
  UserModel: {
    find: jest.fn(),
    updateOne: jest.fn(),
    findById: jest.fn(),
  },
}));

jest.mock('../models/Document', () => ({
  DocumentModel: { findOne: jest.fn() },
  DOCUMENT_TYPES: ['STI_PANEL', 'HIV', 'STI_PARTIAL', 'HEPATITIS', 'VACCINE', 'BLOOD_WORK', 'OTHER'],
}));

import webpush from 'web-push';
import { sendPushNotification, getVapidPublicKey } from '../services/pushNotification';
import { UserModel } from '../models/User';

const mockSendNotification = webpush.sendNotification as jest.MockedFunction<typeof webpush.sendNotification>;
const mockUpdateOne = UserModel.updateOne as jest.MockedFunction<typeof UserModel.updateOne>;

const subscription = {
  endpoint: 'https://push.example.com/sub/test',
  keys: { p256dh: 'pk123', auth: 'ak123' },
};

const payload = { title: 'Test', body: 'Test body', url: '/wallet' };

describe('sendPushNotification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls webpush.sendNotification with correct arguments', async () => {
    mockSendNotification.mockResolvedValueOnce({} as never);

    await sendPushNotification(subscription, payload);

    expect(mockSendNotification).toHaveBeenCalledWith(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
      },
      JSON.stringify(payload),
    );
  });

  it('clears stale subscription on 410 Gone response', async () => {
    const goneError = Object.assign(new Error('Gone'), { statusCode: 410 });
    mockSendNotification.mockRejectedValueOnce(goneError);
    mockUpdateOne.mockResolvedValueOnce({} as never);

    await expect(sendPushNotification(subscription, payload)).resolves.toBeUndefined();

    expect(mockUpdateOne).toHaveBeenCalledWith(
      { 'pushSubscription.endpoint': subscription.endpoint },
      { $unset: { pushSubscription: '' } },
    );
  });

  it('re-throws non-410 errors', async () => {
    const serverError = Object.assign(new Error('Server Error'), { statusCode: 500 });
    mockSendNotification.mockRejectedValueOnce(serverError);

    await expect(sendPushNotification(subscription, payload)).rejects.toThrow('Server Error');
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });
});

describe('getVapidPublicKey', () => {
  it('returns the VAPID_PUBLIC_KEY env var', () => {
    const result = getVapidPublicKey();
    expect(result).toBe('BExamplePublicKey');
  });
});
