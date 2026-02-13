const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api/v1`
  : '/api/v1';

/** Token key in localStorage */
const KIOSK_TOKEN_KEY = 'safeschool_kiosk_token';

function getKioskToken(): string {
  return localStorage.getItem(KIOSK_TOKEN_KEY) || '';
}

async function request(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<any> {
  const authToken = token || getKioskToken();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `${method} ${path}: ${res.status}`);
  }

  return res.json();
}

/**
 * Shared API client for kiosk visitor check-in flow.
 * Uses the kiosk token from localStorage.
 */
export const kioskApi = {
  get: (path: string) => request('GET', path),
  post: (path: string, body: unknown) => request('POST', path, body),
};

/**
 * Raw fetch for auth endpoints (no token needed).
 */
export async function authLogin(pin: string): Promise<{ token: string }> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Authentication failed');
  }

  return res.json();
}

export { KIOSK_TOKEN_KEY };
