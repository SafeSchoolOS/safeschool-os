import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_PREFIX = '@safeschool_cache_';
const QUEUE_KEY = '@safeschool_action_queue';

export interface CachedEntry<T> {
  data: T;
  cachedAt: number;
}

export interface QueuedAction {
  type: string;
  url: string;
  method: string;
  body: any;
  queuedAt: number;
}

export async function cacheData(key: string, data: any): Promise<void> {
  await AsyncStorage.setItem(
    CACHE_PREFIX + key,
    JSON.stringify({ data, cachedAt: Date.now() })
  );
}

export async function getCachedData<T>(
  key: string,
  maxAgeMs = 30 * 60 * 1000
): Promise<CachedEntry<T> | null> {
  const raw = await AsyncStorage.getItem(CACHE_PREFIX + key);
  if (!raw) return null;
  const parsed: CachedEntry<T> = JSON.parse(raw);
  if (Date.now() - parsed.cachedAt > maxAgeMs) return null;
  return parsed;
}

export async function queueAction(action: {
  type: string;
  url: string;
  method: string;
  body: any;
}): Promise<void> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  const queue: QueuedAction[] = raw ? JSON.parse(raw) : [];
  queue.push({ ...action, queuedAt: Date.now() });
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function getQueueLength(): Promise<number> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return 0;
  const queue: QueuedAction[] = JSON.parse(raw);
  return queue.length;
}

export async function processQueue(
  apiBase: string,
  token: string
): Promise<number> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return 0;
  const queue: QueuedAction[] = JSON.parse(raw);
  if (queue.length === 0) return 0;

  let processed = 0;
  for (const action of queue) {
    try {
      await fetch(`${apiBase}${action.url}`, {
        method: action.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(action.body),
      });
      processed++;
    } catch {
      // Network still down -- stop processing and keep remaining items
      break;
    }
  }

  const remaining = queue.slice(processed);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  return processed;
}
