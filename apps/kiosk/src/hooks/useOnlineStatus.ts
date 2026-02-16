import { useState, useEffect, useCallback } from 'react';
import { syncPendingCheckins } from '../services/sync-manager';
import { getPendingCheckins } from '../services/offline-store';

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);

  const refreshPendingCount = useCallback(async () => {
    try {
      const pending = await getPendingCheckins();
      setPendingSyncCount(pending.length);
    } catch {
      // IndexedDB may not be available
    }
  }, []);

  const syncNow = useCallback(async () => {
    if (!navigator.onLine) return;
    try {
      await syncPendingCheckins();
      await refreshPendingCount();
    } catch {
      // Sync failed, will retry later
    }
  }, [refreshPendingCount]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      syncNow();
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial count
    refreshPendingCount();

    // Periodically refresh pending count
    const interval = setInterval(refreshPendingCount, 30_000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [syncNow, refreshPendingCount]);

  return { isOnline, pendingSyncCount, syncNow };
}
