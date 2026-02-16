import { getPendingCheckins, markSynced } from './offline-store';
import { kioskApi } from '../api/client';

export async function syncPendingCheckins(): Promise<{ synced: number; failed: number }> {
  const pending = await getPendingCheckins();
  let synced = 0;
  let failed = 0;

  for (const checkin of pending) {
    try {
      const visitor = await kioskApi.post('/visitors', checkin.data);
      await kioskApi.post(`/visitors/${visitor.id}/check-in`, {});
      await markSynced(checkin.id);
      synced++;
    } catch {
      failed++;
    }
  }

  return { synced, failed };
}
