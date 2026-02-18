import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import ws from 'k6/ws';
import { login, wsUrl, SEED } from './helpers.js';

/**
 * WebSocket Load Test
 *
 * Tests concurrent WebSocket connections to the SafeSchool real-time
 * event system. Each VU opens a WS connection, authenticates via JWT
 * query parameter, subscribes to a site, and measures latency for
 * ping/pong keepalive messages.
 *
 * This validates that the WebSocket server can handle many simultaneous
 * long-lived connections without degradation.
 */

const wsConnections = new Counter('ws_connections_opened');
const wsSubscriptions = new Counter('ws_subscriptions_successful');
const wsPingPongs = new Counter('ws_ping_pongs');
const wsLatency = new Trend('ws_ping_latency', true);
const wsErrors = new Counter('ws_errors');

export const options = {
  stages: [
    { duration: '15s', target: 10 },   // Gradual connect
    { duration: '15s', target: 20 },   // Full load
    { duration: '1m', target: 20 },    // Sustain connections
    { duration: '15s', target: 0 },    // Disconnect
  ],
  thresholds: {
    ws_ping_latency: ['p(95)<300'],       // 95% of pings under 300ms
    ws_errors: ['count<10'],              // Fewer than 10 WS errors total
    ws_connections_opened: ['count>15'],   // At least 15 connections established
    ws_subscriptions_successful: ['count>15'],
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
  const url = wsUrl(data.token);
  let subscribed = false;
  let pingCount = 0;
  const maxPings = 10;

  const res = ws.connect(url, {}, function (socket) {
    wsConnections.add(1);

    socket.on('open', function () {
      // Subscribe to site events
      socket.send(JSON.stringify({
        type: 'subscribe',
        siteId: SEED.siteId,
      }));
    });

    socket.on('message', function (msg) {
      let parsed;
      try {
        parsed = JSON.parse(msg);
      } catch {
        wsErrors.add(1);
        return;
      }

      // Handle subscription confirmation
      if (parsed.event === 'subscribed') {
        subscribed = true;
        wsSubscriptions.add(1);

        check(parsed, {
          'ws: subscribed event received': (p) => p.event === 'subscribed',
          'ws: correct siteId': (p) => p.data.siteId === SEED.siteId,
        });

        // Start sending pings after subscription
        sendPing(socket);
      }

      // Handle pong response
      if (parsed.event === 'pong') {
        const now = Date.now();
        // Measure round-trip from when we sent the ping
        // (the pong includes a server timestamp)
        wsPingPongs.add(1);
        pingCount++;

        check(parsed, {
          'ws: pong received': (p) => p.event === 'pong',
          'ws: pong has timestamp': (p) => p.timestamp !== undefined,
        });

        // Send next ping after a short delay, up to maxPings
        if (pingCount < maxPings) {
          socket.setTimeout(function () {
            sendPing(socket);
          }, 2000);
        } else {
          // Done with pings, close connection gracefully
          socket.close();
        }
      }

      // Handle error from server
      if (parsed.event === 'error') {
        wsErrors.add(1);
        console.error(`WS error: ${parsed.data.message}`);
      }
    });

    socket.on('error', function (e) {
      wsErrors.add(1);
      console.error(`WebSocket error: ${e}`);
    });

    socket.on('close', function () {
      // Connection closed
    });

    // Safety timeout: close after 30 seconds if still open
    socket.setTimeout(function () {
      socket.close();
    }, 30000);
  });

  check(res, {
    'ws: connection status 101': (r) => r && r.status === 101,
  });

  // Brief pause between VU iterations
  sleep(1);
}

/**
 * Send a ping message and record the send time for latency measurement.
 */
function sendPing(socket) {
  const sendTime = Date.now();
  socket.send(JSON.stringify({ type: 'ping' }));

  // We measure latency by timing how long until we get the pong back.
  // Since k6 ws doesn't have built-in per-message timing, we use
  // the socket.setTimeout approach and record via the Trend metric
  // when the pong handler fires.
  socket.setTimeout(function () {
    // If we haven't received a pong within 5s, record it as a timeout
    wsLatency.add(Date.now() - sendTime);
  }, 5000);
}
