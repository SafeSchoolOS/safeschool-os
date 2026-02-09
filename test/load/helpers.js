import http from 'k6/http';

/**
 * Base URL for the SafeSchool API.
 * Override with: k6 run -e API_URL=https://your-api.example.com ...
 */
export const API_URL = __ENV.API_URL || 'http://localhost:3000';

/**
 * Default seed data IDs for testing.
 */
export const SEED = {
  siteId: __ENV.SITE_ID || '00000000-0000-4000-a000-000000000001',
  buildingId: '00000000-0000-4000-a000-000000000010',
  roomId: '00000000-0000-4000-a000-000000000101',
};

/**
 * Authenticate against the SafeSchool API and return a JWT token.
 *
 * @param {string} [email] - User email (defaults to TEST_EMAIL env or seeded admin)
 * @param {string} [password] - User password (defaults to TEST_PASSWORD env or safeschool123)
 * @returns {string} JWT token
 */
export function login(email, password) {
  const payload = JSON.stringify({
    email: email || __ENV.TEST_EMAIL || 'bwattendorf@gmail.com',
    password: password || __ENV.TEST_PASSWORD || 'safeschool123',
  });

  const res = http.post(`${API_URL}/api/v1/auth/login`, payload, {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'login' },
  });

  if (res.status !== 200) {
    console.error(`Login failed: ${res.status} - ${res.body}`);
    return null;
  }

  const body = JSON.parse(res.body);
  return body.token;
}

/**
 * Build request headers with JWT authorization.
 *
 * @param {string} token - JWT token from login()
 * @returns {object} Headers object suitable for k6 http requests
 */
export function authHeaders(token) {
  return {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  };
}

/**
 * Build the WebSocket URL with JWT token as query parameter.
 *
 * @param {string} token - JWT token from login()
 * @returns {string} WebSocket URL with token
 */
export function wsUrl(token) {
  const base = API_URL.replace(/^http/, 'ws');
  return `${base}/ws?token=${token}`;
}
