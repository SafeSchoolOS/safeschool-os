/**
 * HTTP route handlers for the setup wizard API.
 */

import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { validateKey } from '@edgeruntime/activation';
import { getProductConfig, getProductSlug } from './product-config.js';
import { writeEnvFile, type WizardConfig } from './env-writer.js';

const execFileAsync = promisify(execFile);

const INSTALL_DIR = process.env.INSTALL_DIR ?? '/opt/edgeruntime';

/** Parse JSON body from an incoming request */
function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf-8');
        resolve(text ? JSON.parse(text) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

/** Send JSON response. Returns a promise that resolves when the response is flushed. */
function json(res: ServerResponse, status: number, data: unknown): Promise<void> {
  return new Promise((resolve) => {
    const body = JSON.stringify(data);
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body, () => resolve());
  });
}

/** POST /api/validate-key — offline activation key validation */
export async function handleValidateKey(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await parseBody(req);
  const key = body?.key;
  if (!key || typeof key !== 'string') {
    json(res, 400, { valid: false, error: 'Missing "key" in request body' });
    return;
  }

  const result = validateKey(key);
  json(res, 200, {
    valid: result.valid,
    error: result.error,
    products: result.products,
    tier: result.tier,
    proxyUrl: result.proxyUrl,
  });
}

/** POST /api/save-config — write .env and signal shutdown */
export async function handleSaveConfig(
  req: IncomingMessage,
  res: ServerResponse,
  onShutdown: () => void,
): Promise<void> {
  const body = await parseBody(req);
  const { activationKey, siteName, orgName, siteId } = body ?? {};

  if (!activationKey || !siteName || !orgName || !siteId) {
    json(res, 400, { error: 'Missing required fields: activationKey, siteName, orgName, siteId' });
    return;
  }

  const config: WizardConfig = { activationKey, siteName, orgName, siteId };
  const productConfig = getProductConfig();

  try {
    writeEnvFile(INSTALL_DIR, productConfig.activationKeyEnvVar, config);
    // Wait for the response to fully flush to the client before shutting down
    await json(res, 200, { success: true, message: 'Configuration saved. Starting services...' });
    setTimeout(onShutdown, 100);
  } catch (err: any) {
    json(res, 500, { error: `Failed to write .env: ${err.message}` });
  }
}

/** POST /api/generate-uuid — return a random UUID v4 */
export async function handleGenerateUuid(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  json(res, 200, { uuid: randomUUID() });
}

/** GET /api/product-info — return product label, env var, and defaults */
export async function handleProductInfo(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const config = getProductConfig();
  const slug = getProductSlug();
  json(res, 200, {
    product: slug,
    label: config.label,
    activationKeyEnvVar: config.activationKeyEnvVar,
    accentColor: config.accentColor,
    defaultSiteName: config.defaultSiteName,
    defaultOrgName: config.defaultOrgName,
  });
}

// ─── WiFi & Network Endpoints ────────────────────────────────────────────────

interface WifiNetwork {
  ssid: string;
  signal: number;
  security: string;
}

/** GET /api/wifi/scan — Scan for available WiFi networks */
export async function handleWifiScan(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const { stdout } = await execFileAsync('iwlist', ['wlan0', 'scan'], { timeout: 15000 });
    const networks = parseIwlistOutput(stdout);
    json(res, 200, { networks });
  } catch (err: any) {
    // iwlist may not be available or wlan0 may not exist (e.g., Ethernet-only setup)
    json(res, 200, { networks: [], error: err.message });
  }
}

/** POST /api/wifi/configure — Save WiFi credentials as wpa_supplicant.conf */
export async function handleWifiConfigure(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await parseBody(req);
  const { ssid, password } = body ?? {};

  if (!ssid || typeof ssid !== 'string') {
    json(res, 400, { error: 'Missing SSID' });
    return;
  }

  const wpaConf = generateWpaSupplicantConf(ssid, password);
  const confPath = `${INSTALL_DIR}/wifi.conf`;

  try {
    writeFileSync(confPath, wpaConf, { mode: 0o600 });
    json(res, 200, { success: true, message: `WiFi credentials saved for "${ssid}"` });
  } catch (err: any) {
    json(res, 500, { error: `Failed to write WiFi config: ${err.message}` });
  }
}

/** GET /api/network/status — Show current network interface status */
export async function handleNetworkStatus(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const interfaces: Record<string, { ip?: string; mac?: string; up: boolean }> = {};

  const nets = networkInterfaces();
  for (const [name, ifaces] of Object.entries(nets)) {
    if (!ifaces || name === 'lo') continue;
    const ipv4 = ifaces.find(i => i.family === 'IPv4' && !i.internal);
    interfaces[name] = {
      ip: ipv4?.address,
      mac: ifaces[0]?.mac,
      up: !!ipv4,
    };
  }

  // Check internet connectivity
  let internetReachable = false;
  try {
    await execFileAsync('curl', ['-sf', '--connect-timeout', '3', 'https://ghcr.io'], { timeout: 5000 });
    internetReachable = true;
  } catch { /* no internet */ }

  json(res, 200, { interfaces, internetReachable });
}

/** Parse iwlist scan output into structured network list */
function parseIwlistOutput(output: string): WifiNetwork[] {
  const networks: WifiNetwork[] = [];
  const cells = output.split(/Cell \d+/);

  for (const cell of cells) {
    const ssidMatch = cell.match(/ESSID:"([^"]*)"/);
    const signalMatch = cell.match(/Signal level[=:](-?\d+)/);
    const encMatch = cell.match(/Encryption key:(on|off)/);

    if (ssidMatch?.[1]) {
      networks.push({
        ssid: ssidMatch[1],
        signal: signalMatch?.[1] ? parseInt(signalMatch[1], 10) : -100,
        security: encMatch?.[1] === 'on' ? 'WPA/WPA2' : 'Open',
      });
    }
  }

  // Deduplicate by SSID, keep strongest signal
  const seen = new Map<string, WifiNetwork>();
  for (const net of networks) {
    const existing = seen.get(net.ssid);
    if (!existing || net.signal > existing.signal) {
      seen.set(net.ssid, net);
    }
  }

  return [...seen.values()].sort((a, b) => b.signal - a.signal);
}

/** Generate wpa_supplicant.conf content */
function generateWpaSupplicantConf(ssid: string, password?: string): string {
  const lines = [
    'ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev',
    'update_config=1',
    'country=US',
    '',
    'network={',
    `    ssid="${ssid}"`,
  ];

  if (password) {
    lines.push(`    psk="${password}"`);
    lines.push('    key_mgmt=WPA-PSK');
  } else {
    lines.push('    key_mgmt=NONE');
  }

  lines.push('}', '');
  return lines.join('\n');
}
