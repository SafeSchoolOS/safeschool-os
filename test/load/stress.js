import http from 'k6/http';
import { check, sleep } from 'k6';
import { login, authHeaders, API_URL } from './helpers.js';

/**
 * Stress Test
 *
 * Gradually ramps from 10 to 100 VUs over 5 minutes to find the
 * breaking point of the API. Uses the same core endpoints as baseline
 * but with more aggressive request patterns and relaxed thresholds.
 */
export const options = {
  stages: [
    { duration: '30s', target: 10 },   // Warm up
    { duration: '1m', target: 30 },    // Moderate load
    { duration: '1m', target: 60 },    // Heavy load
    { duration: '1m', target: 100 },   // Peak load
    { duration: '30s', target: 100 },  // Sustain peak
    { duration: '1m', target: 0 },     // Ramp down / recovery
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],  // 95% of requests under 1s
    http_req_failed: ['rate<0.05'],     // Less than 5% failure rate
    'http_req_duration{name:health}': ['p(99)<500'],
    'http_req_duration{name:alerts}': ['p(95)<1000'],
    'http_req_duration{name:sites}': ['p(95)<1000'],
    'http_req_duration{name:doors}': ['p(95)<1000'],
    'http_req_duration{name:auth_me}': ['p(95)<1000'],
  },
};

export function setup() {
  const token = login();
  if (!token) {
    throw new Error('Setup failed: could not authenticate. Is the API running and seeded?');
  }
  return { token };
}

export default function (data) {
  const params = authHeaders(data.token);

  // Health check
  const healthRes = http.get(`${API_URL}/health`, {
    tags: { name: 'health' },
  });
  check(healthRes, {
    'health: status 200': (r) => r.status === 200,
  });

  sleep(0.3);

  // Auth me - validates token is still working under load
  const meRes = http.get(`${API_URL}/api/v1/auth/me`, {
    ...params,
    tags: { name: 'auth_me' },
  });
  check(meRes, {
    'auth/me: status 200': (r) => r.status === 200,
    'auth/me: has email': (r) => JSON.parse(r.body).email !== undefined,
  });

  sleep(0.3);

  // Fetch alerts
  const alertsRes = http.get(`${API_URL}/api/v1/alerts`, {
    ...params,
    tags: { name: 'alerts' },
  });
  check(alertsRes, {
    'alerts: status 200': (r) => r.status === 200,
  });

  sleep(0.3);

  // Fetch sites with full building/room data
  const sitesRes = http.get(`${API_URL}/api/v1/sites`, {
    ...params,
    tags: { name: 'sites' },
  });
  check(sitesRes, {
    'sites: status 200': (r) => r.status === 200,
  });

  sleep(0.3);

  // Fetch doors
  const doorsRes = http.get(`${API_URL}/api/v1/doors`, {
    ...params,
    tags: { name: 'doors' },
  });
  check(doorsRes, {
    'doors: status 200': (r) => r.status === 200,
  });

  // Shorter think time under stress to increase request rate
  sleep(Math.random() * 1 + 0.5);
}
