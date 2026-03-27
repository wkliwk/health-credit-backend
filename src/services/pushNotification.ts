import webpush from 'web-push';
import { IPushSubscription, UserModel } from '../models/User';

webpush.setVapidDetails(
  `mailto:${process.env.VAPID_EMAIL || 'mailto:hello@healthcredit.app'}`,
  process.env.VAPID_PUBLIC_KEY || '',
  process.env.VAPID_PRIVATE_KEY || '',
);

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

export async function sendPushNotification(
  subscription: IPushSubscription,
  payload: PushPayload,
): Promise<void> {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
        },
      },
      JSON.stringify(payload),
    );
  } catch (err: unknown) {
    const error = err as { statusCode?: number };
    if (error.statusCode === 410) {
      // Subscription is no longer valid — clear it from the user document
      await UserModel.updateOne(
        { 'pushSubscription.endpoint': subscription.endpoint },
        { $unset: { pushSubscription: '' } },
      );
    } else {
      throw err;
    }
  }
}

export function getVapidPublicKey(): string {
  return process.env.VAPID_PUBLIC_KEY || '';
}
