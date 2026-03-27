import cron from 'node-cron';
import { UserModel } from '../models/User';
import { DocumentModel, DocumentType } from '../models/Document';
import { sendPushNotification } from '../services/pushNotification';

// Freshness windows in days per document type
const FRESHNESS_WINDOWS: Record<DocumentType, number> = {
  STI_PANEL: 90,
  HIV: 90,
  STI_PARTIAL: 90,
  HEPATITIS: 180,
  VACCINE: 365,
  BLOOD_WORK: 180,
  OTHER: 180,
};

export function computeFreshnessExpiresAt(createdAt: Date, documentType: DocumentType): Date {
  const windowDays = FRESHNESS_WINDOWS[documentType];
  return new Date(createdAt.getTime() + windowDays * 24 * 60 * 60 * 1000);
}

export function getFreshnessWindowDays(documentType: DocumentType): number {
  return FRESHNESS_WINDOWS[documentType];
}

/**
 * Returns true if the given expiry date is within ±12 hours of `daysFromNow` days in the future.
 */
export function isExpiringIn(freshnessExpiresAt: Date, daysFromNow: number, now: Date): boolean {
  const targetMs = now.getTime() + daysFromNow * 24 * 60 * 60 * 1000;
  const windowMs = 12 * 60 * 60 * 1000; // ±12 hours
  return Math.abs(freshnessExpiresAt.getTime() - targetMs) <= windowMs;
}

export async function runExpiryNotifications(): Promise<void> {
  try {
    const now = new Date();

    // Only fetch users who have a push subscription
    const users = await UserModel.find({ pushSubscription: { $exists: true, $ne: null } });

    for (const user of users) {
      if (!user.pushSubscription) continue;

      // Find user's most recent document of each type
      const documentTypes = Object.keys(FRESHNESS_WINDOWS) as DocumentType[];
      for (const docType of documentTypes) {
        const doc = await DocumentModel.findOne(
          { userId: String(user._id), documentType: docType },
          { createdAt: 1, documentType: 1 },
        ).sort({ createdAt: -1 });

        if (!doc) continue;

        const freshnessExpiresAt = computeFreshnessExpiresAt(doc.createdAt, docType);

        if (isExpiringIn(freshnessExpiresAt, 7, now)) {
          await sendPushNotification(user.pushSubscription, {
            title: 'Your health docs expire in 7 days',
            body: 'Refresh your results to keep your Trust Score up.',
            url: '/wallet',
          });
        } else if (isExpiringIn(freshnessExpiresAt, 1, now)) {
          await sendPushNotification(user.pushSubscription, {
            title: 'Your health docs expire tomorrow',
            body: "Don't let your Trust Score drop — upload new results today.",
            url: '/wallet',
          });
        }
      }
    }
  } catch (error) {
    console.error('Expiry notification job error:', error);
  }
}

export function startExpiryReminderJob(): void {
  // Run daily at 9am UTC
  cron.schedule('0 9 * * *', () => {
    void runExpiryNotifications();
  });

  console.log('Expiry reminder cron job registered (runs daily at 9am UTC)');
}
