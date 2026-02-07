const API_BASE = import.meta.env.VITE_API_URL || '';
const authProvider = import.meta.env.VITE_AUTH_PROVIDER || 'dev';

class ApiClient {
  private getHeaders(token?: string | null): HeadersInit {
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  private async getToken(): Promise<string | null> {
    if (authProvider === 'clerk') {
      try {
        const clerkInstance = (window as any).__clerk;
        if (clerkInstance?.session) {
          return await clerkInstance.session.getToken();
        }
      } catch {
        // Clerk not available
      }
      return null;
    }
    return localStorage.getItem('safeschool_token');
  }

  async get(url: string, token?: string | null): Promise<any> {
    const authToken = token ?? await this.getToken();
    const res = await fetch(`${API_BASE}${url}`, {
      headers: this.getHeaders(authToken),
    });
    if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
    return res.json();
  }

  async post(url: string, body: any, token?: string | null): Promise<any> {
    const authToken = token ?? await this.getToken();
    const res = await fetch(`${API_BASE}${url}`, {
      method: 'POST',
      headers: this.getHeaders(authToken),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `POST ${url}: ${res.status}`);
    }
    return res.json();
  }

  async patch(url: string, body: any, token?: string | null): Promise<any> {
    const authToken = token ?? await this.getToken();
    const res = await fetch(`${API_BASE}${url}`, {
      method: 'PATCH',
      headers: this.getHeaders(authToken),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PATCH ${url}: ${res.status}`);
    return res.json();
  }

  async delete(url: string, token?: string | null): Promise<any> {
    const authToken = token ?? await this.getToken();
    const res = await fetch(`${API_BASE}${url}`, {
      method: 'DELETE',
      headers: this.getHeaders(authToken),
    });
    if (!res.ok) throw new Error(`DELETE ${url}: ${res.status}`);
    return res.json();
  }
}

export const apiClient = new ApiClient();
