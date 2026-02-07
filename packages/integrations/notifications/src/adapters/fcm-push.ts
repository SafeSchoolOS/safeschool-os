import type { NotificationAdapter, NotificationPayload, NotificationResult } from '../index.js';

export class FcmPushAdapter implements NotificationAdapter {
  name = 'FCM Push';

  private messaging: any = null;

  constructor() {
    const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const projectId = process.env.FCM_PROJECT_ID;

    if (credentials || projectId) {
      import('firebase-admin').then((admin) => {
        const app = admin.default.apps.length
          ? admin.default.app()
          : admin.default.initializeApp({
              credential: credentials
                ? admin.default.credential.cert(credentials)
                : admin.default.credential.applicationDefault(),
              projectId,
            });
        this.messaging = app.messaging();
      }).catch(() => {
        console.warn('[FcmPushAdapter] firebase-admin package not installed, falling back to console');
      });
    } else {
      console.log('[FcmPushAdapter] GOOGLE_APPLICATION_CREDENTIALS not set, using console fallback');
    }
  }

  async send(notification: NotificationPayload): Promise<NotificationResult> {
    if (!notification.channels?.includes('PUSH')) {
      return { success: true, channel: 'PUSH', sentCount: 0 };
    }

    const recipients = notification.recipients || [];

    if (!this.messaging) {
      console.log(`\n[PUSH FALLBACK] Alert ${notification.alertId}`);
      console.log(`  Title: SafeSchool ${notification.level}`);
      console.log(`  Body: ${notification.message}`);
      console.log(`  Tokens: ${recipients.length > 0 ? recipients.length : 'topic broadcast'}`);
      return { success: true, channel: 'PUSH', sentCount: recipients.length };
    }

    try {
      if (recipients.length > 0) {
        // Send to specific device tokens
        const response = await this.messaging.sendEachForMulticast({
          tokens: recipients,
          notification: {
            title: `SafeSchool ${notification.level}`,
            body: notification.message,
          },
          data: {
            alertId: notification.alertId,
            siteId: notification.siteId,
            level: notification.level,
          },
          android: { priority: 'high' as const },
          apns: {
            payload: { aps: { sound: 'default', badge: 1, 'content-available': 1 } },
          },
        });

        return {
          success: response.successCount > 0,
          channel: 'PUSH',
          sentCount: response.successCount,
        };
      } else {
        // Topic-based broadcast for site-wide alerts
        await this.messaging.send({
          topic: `site_${notification.siteId}`,
          notification: {
            title: `SafeSchool ${notification.level}`,
            body: notification.message,
          },
          data: {
            alertId: notification.alertId,
            siteId: notification.siteId,
            level: notification.level,
          },
        });

        return { success: true, channel: 'PUSH', sentCount: 1 };
      }
    } catch (err) {
      console.error('[FcmPushAdapter] Send failed:', err);
      return { success: false, channel: 'PUSH', sentCount: 0, error: String(err) };
    }
  }
}
