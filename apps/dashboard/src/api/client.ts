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

  private async request(method: string, url: string, body?: any, token?: string | null): Promise<any> {
    const authToken = token ?? await this.getToken();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch(`${API_BASE}${url}`, {
        method,
        headers: this.getHeaders(authToken),
        body: body != null ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `${method} ${url}: ${res.status}`);
      }
      return res.json();
    } catch (e: any) {
      clearTimeout(timeout);
      if (e.name === 'AbortError') throw new Error(`${method} ${url}: request timed out`);
      throw e;
    }
  }

  get(url: string, token?: string | null) { return this.request('GET', url, undefined, token); }
  post(url: string, body: any, token?: string | null) { return this.request('POST', url, body, token); }
  put(url: string, body: any, token?: string | null) { return this.request('PUT', url, body, token); }
  patch(url: string, body: any, token?: string | null) { return this.request('PATCH', url, body, token); }
  delete(url: string, token?: string | null) { return this.request('DELETE', url, undefined, token); }
}

export const apiClient = new ApiClient();
