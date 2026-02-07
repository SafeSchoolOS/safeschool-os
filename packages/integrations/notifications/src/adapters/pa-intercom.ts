import type { NotificationAdapter, NotificationPayload, NotificationResult } from '../index.js';

export class PaIntercomAdapter implements NotificationAdapter {
  name = 'PA/Intercom';

  private endpoint: string | null;

  constructor() {
    this.endpoint = process.env.PA_INTERCOM_ENDPOINT || null;

    if (!this.endpoint) {
      console.log('[PaIntercomAdapter] PA_INTERCOM_ENDPOINT not set, using console fallback');
    }
  }

  async send(notification: NotificationPayload): Promise<NotificationResult> {
    if (!notification.channels?.includes('PA')) {
      return { success: true, channel: 'PA', sentCount: 0 };
    }

    if (!this.endpoint) {
      console.log(`\n[PA FALLBACK] Alert ${notification.alertId}`);
      console.log(`  Announcement: ${notification.message}`);
      console.log(`  Level: ${notification.level}`);
      return { success: true, channel: 'PA', sentCount: 1 };
    }

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.PA_INTERCOM_API_KEY
            ? { 'Authorization': `Bearer ${process.env.PA_INTERCOM_API_KEY}` }
            : {}),
        },
        body: JSON.stringify({
          message: notification.message,
          priority: notification.level === 'ACTIVE_THREAT' ? 'emergency' : 'high',
          zones: notification.recipients || ['all'],
          repeat: notification.level === 'ACTIVE_THREAT' ? 3 : 1,
        }),
        signal: AbortSignal.timeout(5000),
      });

      return {
        success: response.ok,
        channel: 'PA',
        sentCount: response.ok ? 1 : 0,
        error: response.ok ? undefined : `PA system returned ${response.status}`,
      };
    } catch (err) {
      console.error('[PaIntercomAdapter] Send failed:', err);
      return {
        success: false,
        channel: 'PA',
        sentCount: 0,
        error: err instanceof Error ? err.message : 'PA system unreachable',
      };
    }
  }
}
