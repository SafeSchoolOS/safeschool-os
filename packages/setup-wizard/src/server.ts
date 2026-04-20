/**
 * EdgeRuntime Setup Wizard — Standalone HTTP Server
 *
 * Runs on first boot when the activation key is empty.
 * Serves a single-page setup wizard UI and handles config API calls.
 * Exits after the customer completes setup.
 */

import http from 'node:http';
import { networkInterfaces } from 'node:os';
import { handleValidateKey, handleSaveConfig, handleGenerateUuid, handleProductInfo, handleWifiScan, handleWifiConfigure, handleNetworkStatus, handlePairingCode, handlePairingStatus } from './routes.js';
import { getProductConfig } from './product-config.js';

// The HTML is embedded at build time by esbuild's define
declare const __WIZARD_HTML__: string;

const PRIMARY_PORT = 80;
const FALLBACK_PORT = 8080;

function getLocalIp(): string {
  const nets = networkInterfaces();
  for (const ifaces of Object.values(nets)) {
    if (!ifaces) continue;
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// Well-known captive portal detection paths used by devices/browsers.
// Responding with a redirect triggers the device to show its captive portal UI.
const CAPTIVE_PORTAL_PATHS = new Set([
  // Apple iOS / macOS
  '/hotspot-detect.html',
  '/library/test/success.html',
  // Android / Google
  '/generate_204',
  '/gen_204',
  '/connecttest.txt',
  // Windows
  '/ncsi.txt',
  '/connecttest.txt',
  // Firefox
  '/success.txt',
  '/canonical.html',
]);

function createServer(): http.Server {
  let shutdownCalled = false;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const method = req.method ?? 'GET';

    try {
      // Captive portal detection — redirect to wizard so the device shows a login prompt
      if (method === 'GET' && CAPTIVE_PORTAL_PATHS.has(url.pathname)) {
        res.writeHead(302, { Location: 'http://192.168.4.1/' });
        res.end();
        return;
      }

      // API routes
      if (method === 'POST' && url.pathname === '/api/validate-key') {
        await handleValidateKey(req, res);
        return;
      }
      if (method === 'POST' && url.pathname === '/api/save-config') {
        await handleSaveConfig(req, res, () => {
          if (!shutdownCalled) {
            shutdownCalled = true;
            console.log('\nConfiguration saved. Shutting down wizard...');
            server.close(() => process.exit(0));
            // Force exit after 3s if connections linger
            setTimeout(() => process.exit(0), 3000);
          }
        });
        return;
      }
      if (method === 'POST' && url.pathname === '/api/generate-uuid') {
        await handleGenerateUuid(req, res);
        return;
      }
      if (method === 'GET' && url.pathname === '/api/product-info') {
        await handleProductInfo(req, res);
        return;
      }
      if (method === 'GET' && url.pathname === '/api/wifi/scan') {
        await handleWifiScan(req, res);
        return;
      }
      if (method === 'POST' && url.pathname === '/api/wifi/configure') {
        await handleWifiConfigure(req, res);
        return;
      }
      if (method === 'GET' && url.pathname === '/api/network/status') {
        await handleNetworkStatus(req, res);
        return;
      }
      if (method === 'GET' && url.pathname === '/api/pairing/code') {
        await handlePairingCode(req, res);
        return;
      }
      if (method === 'GET' && url.pathname === '/api/pairing/status') {
        await handlePairingStatus(req, res, () => {
          if (!shutdownCalled) {
            shutdownCalled = true;
            console.log('\nDevice paired. Shutting down wizard...');
            server.close(() => process.exit(0));
            setTimeout(() => process.exit(0), 3000);
          }
        });
        return;
      }

      // Serve wizard HTML for any other GET request
      if (method === 'GET') {
        const html = __WIZARD_HTML__;
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': Buffer.byteLength(html),
          'Cache-Control': 'no-cache',
        });
        res.end(html);
        return;
      }

      // 404 for anything else
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    } catch (err: any) {
      console.error(`Error handling ${method} ${url.pathname}:`, err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    }
  });

  return server;
}

function start(): void {
  const config = getProductConfig();
  const server = createServer();

  let fallbackAttempted = false;
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (!fallbackAttempted && (err.code === 'EACCES' || err.code === 'EADDRINUSE')) {
      fallbackAttempted = true;
      console.log(`Port ${PRIMARY_PORT} unavailable (${err.code}), trying port ${FALLBACK_PORT}...`);
      server.listen(FALLBACK_PORT, '0.0.0.0');
      return;
    }
    console.error('Server error:', err);
    process.exit(1);
  });

  server.listen(PRIMARY_PORT, '0.0.0.0', () => {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : PRIMARY_PORT;
    const ip = getLocalIp();
    const url = port === 80 ? `http://${ip}` : `http://${ip}:${port}`;

    console.log('');
    console.log(`========================================`);
    console.log(`  ${config.label} Setup Wizard`);
    console.log(`========================================`);
    console.log('');
    console.log(`  Open a browser and go to:`);
    console.log('');
    console.log(`    ${url}`);
    console.log('');
    console.log(`  Waiting for configuration...`);
    console.log('');
  });
}

start();
