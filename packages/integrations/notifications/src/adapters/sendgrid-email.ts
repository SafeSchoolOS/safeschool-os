import type { NotificationAdapter, NotificationPayload, NotificationResult } from '../index.js';

export class SendGridEmailAdapter implements NotificationAdapter {
  name = 'SendGrid Email';

  private sgMail: any = null;
  private fromEmail: string;

  constructor() {
    this.fromEmail = process.env.SENDGRID_FROM_EMAIL || 'alerts@safeschool.app';

    const apiKey = process.env.SENDGRID_API_KEY;

    if (apiKey) {
      import('@sendgrid/mail').then((mod) => {
        this.sgMail = mod.default;
        this.sgMail.setApiKey(apiKey);
      }).catch(() => {
        console.warn('[SendGridEmailAdapter] @sendgrid/mail package not installed, falling back to console');
      });
    } else {
      console.log('[SendGridEmailAdapter] SENDGRID_API_KEY not set, using console fallback');
    }
  }

  async send(notification: NotificationPayload): Promise<NotificationResult> {
    if (!notification.channels?.includes('EMAIL')) {
      return { success: true, channel: 'EMAIL', sentCount: 0 };
    }

    const recipients = notification.recipients || [];

    if (!this.sgMail) {
      console.log(`\n[EMAIL FALLBACK] Alert ${notification.alertId}`);
      console.log(`  Subject: SafeSchool ${notification.level} Alert`);
      console.log(`  Message: ${notification.message}`);
      console.log(`  Recipients: ${recipients.length > 0 ? recipients.join(', ') : 'broadcast'}`);
      return { success: true, channel: 'EMAIL', sentCount: recipients.length };
    }

    let sentCount = 0;
    for (const to of recipients) {
      try {
        await this.sgMail.send({
          to,
          from: this.fromEmail,
          subject: `SafeSchool ${notification.level} Alert`,
          text: notification.message,
          html: `<div style="font-family:sans-serif;padding:20px">
            <h2 style="color:#dc2626">SafeSchool Alert: ${notification.level}</h2>
            <p>${notification.message}</p>
            <p style="color:#6b7280;font-size:12px">Site: ${notification.siteId} | Alert: ${notification.alertId}</p>
          </div>`,
        });
        sentCount++;
      } catch (err) {
        console.error(`[SendGridEmailAdapter] Failed to send to ${to}:`, err);
      }
    }

    return { success: sentCount > 0, channel: 'EMAIL', sentCount };
  }
}
