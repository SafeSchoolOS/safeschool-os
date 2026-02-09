import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { login, authHeaders, API_URL, SEED } from './helpers.js';

/**
 * Spike Test
 *
 * Simulates an emergency event: a sudden surge from 5 quiet users to
 * 50 users all hitting the API at once. During an active emergency,
 * users trigger alerts, check door statuses, and poll for alert updates
 * with minimal think time.
 */

const alertsCreated = new Counter('alerts_created');
const emergencyLatency = new Trend('emergency_response_time', true);

export const options = {
  stages: [
    { duration: '10s', target: 5 },    // Normal quiet period
    { duration: '5s', target: 50 },    // Sudden spike (emergency triggered)
    { duration: '1m', target: 50 },    // Sustained emergency response
    { duration: '10s', target: 5 },    // Emergency resolved, users drop off
    { duration: '30s', target: 5 },    // Cool down
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],             // Wider tolerance during spike
    http_req_failed: ['rate<0.10'],                // Up to 10% failures acceptable in spike
    emergency_response_time: ['p(95)<1500'],       // Alert creation must stay responsive
    'http_req_duration{name:create_alert}': ['p(95)<2000'],
    'http_req_duration{name:get_alerts}': ['p(95)<1500'],
    'http_req_duration{name:get_doors}': ['p(95)<1500'],
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

  // Simulate emergency: create a panic alert
  const alertPayload = JSON.stringify({
    level: 'EMERGENCY',
    source: 'LOAD_TEST',
    buildingId: SEED.buildingId,
    roomId: SEED.roomId,
    message: `Load test alert - VU ${__VU} iter ${__ITER}`,
  });

  const alertRes = http.post(`${API_URL}/api/v1/alerts`, alertPayload, {
    ...params,
    tags: { name: 'create_alert' },
  });

  const alertCreated = check(alertRes, {
    'create alert: status 201': (r) => r.status === 201,
    'create alert: has id': (r) => {
      try { return JSON.parse(r.body).id !== undefined; } catch { return false; }
    },
  });

  if (alertCreated) {
    alertsCreated.add(1);
    emergencyLatency.add(alertRes.timings.duration);
  }

  sleep(0.2);

  // Rapidly poll door statuses (checking lockdown state)
  const doorsRes = http.get(`${API_URL}/api/v1/doors`, {
    ...params,
    tags: { name: 'get_doors' },
  });
  check(doorsRes, {
    'doors: status 200': (r) => r.status === 200,
  });

  sleep(0.1);

  // Rapidly poll alert feed (checking for updates)
  const alertsRes = http.get(`${API_URL}/api/v1/alerts?limit=10`, {
    ...params,
    tags: { name: 'get_alerts' },
  });
  check(alertsRes, {
    'alerts: status 200': (r) => r.status === 200,
    'alerts: has results': (r) => {
      try { return JSON.parse(r.body).length > 0; } catch { return false; }
    },
  });

  sleep(0.1);

  // Second rapid poll of doors (users refreshing during emergency)
  http.get(`${API_URL}/api/v1/doors`, {
    ...params,
    tags: { name: 'get_doors' },
  });

  // Second rapid poll of alerts
  http.get(`${API_URL}/api/v1/alerts?limit=10`, {
    ...params,
    tags: { name: 'get_alerts' },
  });

  // Minimal think time during emergency
  sleep(Math.random() * 0.5 + 0.2);
}
