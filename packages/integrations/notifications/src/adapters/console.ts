import type { NotificationAdapter, NotificationPayload, NotificationResult } from '../index.js';

export class ConsoleNotificationAdapter implements NotificationAdapter {
  name = 'Console (Dev)';

  async send(notification: NotificationPayload): Promise<NotificationResult> {
    console.log(`\n📨 NOTIFICATION [${notification.level}]`);
    console.log(`   Alert: ${notification.alertId}`);
    console.log(`   Message: ${notification.message}`);
    console.log(`   Channels: ${(notification.channels || ['ALL']).join(', ')}`);
    console.log(`   Time: ${new Date().toISOString()}\n`);

    return {
      success: true,
      channel: 'CONSOLE',
      sentCount: notification.recipients?.length || 0,
    };
  }
}
