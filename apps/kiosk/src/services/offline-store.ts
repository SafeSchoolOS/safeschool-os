import { openDB, type IDBPDatabase } from 'idb';

interface PendingCheckin {
  id: string;
  data: any;
  createdAt: number;
  synced: boolean;
}

interface CachedEntry {
  key: string;
  value: any;
  updatedAt: number;
}

const DB_NAME = 'safeschool-kiosk';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

async function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('pendingCheckins')) {
          const checkinStore = db.createObjectStore('pendingCheckins', { keyPath: 'id' });
          checkinStore.createIndex('synced', 'synced');
          checkinStore.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('cachedSettings')) {
          db.createObjectStore('cachedSettings', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('cachedPolicies')) {
          db.createObjectStore('cachedPolicies', { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

export async function queueCheckin(data: any): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const entry: PendingCheckin = {
    id,
    data,
    createdAt: Date.now(),
    synced: false,
  };
  await db.put('pendingCheckins', entry);
  return id;
}

export async function getPendingCheckins(): Promise<PendingCheckin[]> {
  const db = await getDb();
  const all: PendingCheckin[] = await db.getAll('pendingCheckins');
  return all.filter((e) => !e.synced).sort((a, b) => a.createdAt - b.createdAt);
}

export async function markSynced(id: string): Promise<void> {
  const db = await getDb();
  const entry = await db.get('pendingCheckins', id);
  if (entry) {
    entry.synced = true;
    await db.put('pendingCheckins', entry);
  }
}

export async function cacheSettings(siteId: string, settings: any): Promise<void> {
  const db = await getDb();
  const entry: CachedEntry = {
    key: siteId,
    value: settings,
    updatedAt: Date.now(),
  };
  await db.put('cachedSettings', entry);
}

export async function getCachedSettings(siteId: string): Promise<any | null> {
  const db = await getDb();
  const entry = await db.get('cachedSettings', siteId);
  return entry?.value ?? null;
}

export async function cachePolicies(siteId: string, policies: any[]): Promise<void> {
  const db = await getDb();
  const entry: CachedEntry = {
    key: siteId,
    value: policies,
    updatedAt: Date.now(),
  };
  await db.put('cachedPolicies', entry);
}

export async function getCachedPolicies(siteId: string): Promise<any[] | null> {
  const db = await getDb();
  const entry = await db.get('cachedPolicies', siteId);
  return entry?.value ?? null;
}
