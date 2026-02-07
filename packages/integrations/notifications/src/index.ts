export interface NotificationAdapter {
  name: string;
  send(notification: NotificationPayload): Promise<NotificationResult>;
}

export interface NotificationPayload {
  alertId: string;
  siteId: string;
  level: string;
  message: string;
  recipients?: string[];
  channels?: ('SMS' | 'EMAIL' | 'PUSH' | 'PA')[];
}

export interface NotificationResult {
  success: boolean;
  channel: string;
  sentCount: number;
  error?: string;
}

export { ConsoleNotificationAdapter } from './adapters/console.js';
export { TwilioSmsAdapter } from './adapters/twilio-sms.js';
export { SendGridEmailAdapter } from './adapters/sendgrid-email.js';
export { FcmPushAdapter } from './adapters/fcm-push.js';
export { PaIntercomAdapter } from './adapters/pa-intercom.js';

type Channel = 'SMS' | 'EMAIL' | 'PUSH' | 'PA';

export class NotificationRouter {
  private adapters: NotificationAdapter[] = [];
  private channelMap: Map<Channel, NotificationAdapter> = new Map();

  register(adapter: NotificationAdapter): void {
    this.adapters.push(adapter);
  }

  registerChannel(channel: Channel, adapter: NotificationAdapter): void {
    this.channelMap.set(channel, adapter);
    if (!this.adapters.includes(adapter)) {
      this.adapters.push(adapter);
    }
  }

  async notify(payload: NotificationPayload): Promise<NotificationResult[]> {
    const results: NotificationResult[] = [];

    if (payload.channels && payload.channels.length > 0 && this.channelMap.size > 0) {
      // Channel-based routing: only dispatch to requested channels
      for (const channel of payload.channels) {
        const adapter = this.channelMap.get(channel);
        if (adapter) {
          const result = await adapter.send(payload);
          results.push(result);
        }
      }
    } else {
      // Legacy: broadcast to all registered adapters
      for (const adapter of this.adapters) {
        const result = await adapter.send(payload);
        results.push(result);
      }
    }

    return results;
  }
}
