import http from 'k6/http';
import { check, sleep } from 'k6';
import { login, authHeaders, API_URL } from './helpers.js';

/**
 * Baseline Load Test
 *
 * Simulates normal operational load: 10 concurrent users browsing the
 * dashboard for 2 minutes. Tests core read endpoints that are hit on
 * every page load (health, alerts, sites, doors).
 */
export const options = {
  vus: 10,
  duration: '2m',
  thresholds: {
    http_req_duration: ['p(95)<500'],   // 95% of requests under 500ms
    http_req_failed: ['rate<0.01'],     // Less than 1% failure rate
    'http_req_duration{name:health}': ['p(99)<200'],   // Health check always fast
    'http_req_duration{name:alerts}': ['p(95)<500'],
    'http_req_duration{name:sites}': ['p(95)<500'],
    'http_req_duration{name:doors}': ['p(95)<500'],
  },
};

/**
 * Setup runs once before the test. Authenticates and returns the JWT token
 * shared across all VUs.
 */
export function setup() {
  const token = login();
  if (!token) {
    throw new Error('Setup failed: could not authenticate. Is the API running and seeded?');
  }
  return { token };
}

/**
 * Default function runs once per VU iteration. Simulates a user loading
 * the dashboard: health check, then fetching alerts, sites, and doors.
 */
export default function (data) {
  const params = authHeaders(data.token);

  // 1. Health check (unauthenticated)
  const healthRes = http.get(`${API_URL}/health`, {
    tags: { name: 'health' },
  });
  check(healthRes, {
    'health: status 200': (r) => r.status === 200,
    'health: status ok': (r) => JSON.parse(r.body).status === 'ok',
  });

  sleep(0.5);

  // 2. Fetch alerts
  const alertsRes = http.get(`${API_URL}/api/v1/alerts`, {
    ...params,
    tags: { name: 'alerts' },
  });
  check(alertsRes, {
    'alerts: status 200': (r) => r.status === 200,
    'alerts: is array': (r) => Array.isArray(JSON.parse(r.body)),
  });

  sleep(0.5);

  // 3. Fetch sites
  const sitesRes = http.get(`${API_URL}/api/v1/sites`, {
    ...params,
    tags: { name: 'sites' },
  });
  check(sitesRes, {
    'sites: status 200': (r) => r.status === 200,
    'sites: is array': (r) => Array.isArray(JSON.parse(r.body)),
  });

  sleep(0.5);

  // 4. Fetch doors
  const doorsRes = http.get(`${API_URL}/api/v1/doors`, {
    ...params,
    tags: { name: 'doors' },
  });
  check(doorsRes, {
    'doors: status 200': (r) => r.status === 200,
    'doors: is array': (r) => Array.isArray(JSON.parse(r.body)),
  });

  // Simulate user think time between page loads
  sleep(Math.random() * 2 + 1);
}
