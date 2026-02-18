import type { DispatchAdapter, DispatchPayload, DispatchResult } from '../index.js';

export class ConsoleDispatchAdapter implements DispatchAdapter {
  name = 'Console (Dev)';

  async dispatch(alert: DispatchPayload): Promise<DispatchResult> {
    const start = Date.now();

    console.log(`\n${'*'.repeat(60)}`);
    console.log(`*  911 DISPATCHED — ${alert.level}`);
    console.log(`*  Alert: ${alert.alertId}`);
    console.log(`*  Location: ${alert.buildingName}${alert.roomName ? ` / ${alert.roomName}` : ''}${alert.floor ? ` (Floor ${alert.floor})` : ''}`);
    if (alert.latitude && alert.longitude) {
      console.log(`*  GPS: ${alert.latitude}, ${alert.longitude}`);
    }
    console.log(`*  Time: ${new Date().toISOString()}`);
    console.log(`${'*'.repeat(60)}\n`);

    return {
      success: true,
      dispatchId: `console-${Date.now()}`,
      method: 'CONSOLE',
      responseTimeMs: Date.now() - start,
    };
  }

  async getStatus(dispatchId: string): Promise<string> {
    return 'DISPATCHED';
  }
}
