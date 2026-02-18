import type { NotificationAdapter, NotificationPayload, NotificationResult } from '../index.js';

export class TwilioSmsAdapter implements NotificationAdapter {
  name = 'Twilio SMS';

  private client: any = null;
  private fromNumber: string;

  constructor() {
    this.fromNumber = process.env.TWILIO_FROM_NUMBER || '';

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (accountSid && authToken) {
      // Lazy-load twilio SDK
      import('twilio').then((mod) => {
        const Twilio = mod.default as any;
        this.client = new Twilio(accountSid, authToken);
      }).catch(() => {
        console.warn('[TwilioSmsAdapter] twilio package not installed, falling back to console');
      });
    } else {
      console.log('[TwilioSmsAdapter] TWILIO_ACCOUNT_SID not set, using console fallback');
    }
  }

  async send(notification: NotificationPayload): Promise<NotificationResult> {
    if (!notification.channels?.includes('SMS')) {
      return { success: true, channel: 'SMS', sentCount: 0 };
    }

    const recipients = notification.recipients || [];

    if (!this.client) {
      // Console fallback
      console.log(`\n[SMS FALLBACK] Alert ${notification.alertId}`);
      console.log(`  Message: ${notification.message}`);
      console.log(`  Recipients: ${recipients.length > 0 ? recipients.join(', ') : 'broadcast'}`);
      return { success: true, channel: 'SMS', sentCount: recipients.length };
    }

    let sentCount = 0;
    for (const to of recipients) {
      try {
        await this.client.messages.create({
          body: `[SafeSchool ${notification.level}] ${notification.message}`,
          from: this.fromNumber,
          to,
          statusCallback: process.env.TWILIO_STATUS_CALLBACK_URL,
        });
        sentCount++;
      } catch (err) {
        console.error(`[TwilioSmsAdapter] Failed to send to ${to}:`, err);
      }
    }

    return { success: sentCount > 0, channel: 'SMS', sentCount };
  }
}
