import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { API_BASE } from '../config';
import { processQueue } from '../utils/offline';
import { getToken } from '../auth/storage';

const POLL_INTERVAL_MS = 15_000;
const HEALTH_TIMEOUT_MS = 5_000;

interface NetworkStatus {
  isOnline: boolean;
  lastChecked: number;
}

export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState(true);
  const [lastChecked, setLastChecked] = useState(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wasOfflineRef = useRef(false);

  const checkHealth = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

      const res = await fetch(`${API_BASE.replace('/api/v1', '')}/health`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const online = res.ok;
      setIsOnline(online);
      setLastChecked(Date.now());

      // If we just came back online, flush the action queue
      if (online && wasOfflineRef.current) {
        wasOfflineRef.current = false;
        const token = await getToken();
        if (token) {
          await processQueue(API_BASE, token);
        }
      }

      if (!online) {
        wasOfflineRef.current = true;
      }
    } catch {
      setIsOnline(false);
      setLastChecked(Date.now());
      wasOfflineRef.current = true;
    }
  }, []);

  useEffect(() => {
    // Check immediately on mount
    checkHealth();

    // Poll at regular intervals
    intervalRef.current = setInterval(checkHealth, POLL_INTERVAL_MS);

    // Re-check when app returns to foreground
    const subscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (nextState === 'active') {
          checkHealth();
        }
      }
    );

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      subscription.remove();
    };
  }, [checkHealth]);

  return { isOnline, lastChecked };
}
