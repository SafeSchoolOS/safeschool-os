import { API_BASE } from '../config';
import { getToken } from '../auth/storage';

class MobileApiClient {
  private async headers(): Promise<HeadersInit> {
    const token = await getToken();
    return {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    };
  }

  async get(path: string) {
    const res = await fetch(`${API_BASE}${path}`, { headers: await this.headers() });
    if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
    return res.json();
  }

  async post(path: string, body: any) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `POST ${path}: ${res.status}`);
    }
    return res.json();
  }

  async patch(path: string, body: any) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'PATCH',
      headers: await this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PATCH ${path}: ${res.status}`);
    return res.json();
  }
}

export const api = new MobileApiClient();
