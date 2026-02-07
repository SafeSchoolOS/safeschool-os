const API_BASE = '/api/v1';

export const kioskApi = {
  async post(path: string, body: any) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getKioskToken()}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || res.statusText); }
    return res.json();
  },
  async get(path: string) {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Authorization': `Bearer ${getKioskToken()}` },
    });
    if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
    return res.json();
  },
};

function getKioskToken(): string {
  return localStorage.getItem('safeschool_kiosk_token') || '';
}
