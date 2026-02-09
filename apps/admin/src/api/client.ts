const BASE_URL = import.meta.env.VITE_API_URL || '';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}/api/v1/admin${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Request failed: ${res.status}`);
  }

  return res.json();
}

export interface SystemStatus {
  uptime: number;
  memory: { total: number; used: number; free: number };
  disk: { total: number; used: number; free: number };
  operatingMode: string;
  nodeVersion: string;
  services: { name: string; status: string }[];
}

export interface SyncState {
  mode: string;
  connected: boolean;
  lastSyncAt: string | null;
  pendingChanges: number;
  queueSize: number;
  cloudUrl: string | null;
}

export interface ConfigEntry {
  key: string;
  value: string;
  redacted: boolean;
}

export interface ServiceInfo {
  name: string;
  status: string;
  uptime: string;
  ports: string;
}

export interface LogEntry {
  timestamp: string;
  message: string;
}

export const adminApi = {
  getStatus: () => request<SystemStatus>('/status'),
  getSync: () => request<SyncState>('/sync'),
  getConfig: () => request<{ config: ConfigEntry[] }>('/config'),
  updateConfig: (updates: Record<string, string>) =>
    request<{ message: string }>('/config', {
      method: 'POST',
      body: JSON.stringify(updates),
    }),
  getServices: () => request<{ services: ServiceInfo[] }>('/services'),
  restartService: (name: string) =>
    request<{ message: string }>(`/services/${name}/restart`, { method: 'POST' }),
  getLogs: (service: string) => request<{ logs: LogEntry[] }>(`/logs/${service}`),
  checkUpdate: () =>
    request<{ message: string }>('/update', { method: 'POST' }),
};
