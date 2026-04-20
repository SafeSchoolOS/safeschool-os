/**
 * HTTP route handlers for the setup wizard API.
 */

import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { validateKey, resolveProxy, PRODUCT_PROXY_INDEX } from '@edgeruntime/activation';
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

    // Auto-detect product from activation key and write config files
    try {
      const keyResult = validateKey(activationKey);
      if (keyResult.valid && keyResult.products && keyResult.products.length > 0) {
        const primaryProduct = keyResult.products[0];

        // Write .product file with the product slug
        writeFileSync(join(INSTALL_DIR, '.product'), primaryProduct + '\n', { mode: 0o644 });

        // Generate config.yaml with module, operating mode, and cloud sync key
        const cloudSyncKey = randomBytes(32).toString('hex');
        const configYaml = [
          'modules:',
          `  - ${primaryProduct}`,
          'operatingMode: EDGE',
          `cloudSyncKey: ${cloudSyncKey}`,
          '',
        ].join('\n');
        writeFileSync(join(INSTALL_DIR, 'config.yaml'), configYaml, { mode: 0o644 });

        // For appliance/ISO mode: copy product-specific configs if bundled
        const productDir = join(INSTALL_DIR, 'products', primaryProduct);
        if (existsSync(productDir)) {
          const filesToCopy = ['docker-compose.yml', 'config.yaml', 'Caddyfile', '.env.example'];
          for (const file of filesToCopy) {
            const src = join(productDir, file);
            if (existsSync(src)) {
              copyFileSync(src, join(INSTALL_DIR, file));
            }
          }
        }

        console.log(`Product auto-detected: ${primaryProduct} (tier: ${keyResult.tier})`);
      }
    } catch (productErr: any) {
      // Non-fatal — wizard still succeeds even if product detection fails
      console.warn(`Warning: product auto-detection failed: ${productErr.message}`);
    }

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

/** POST /api/wifi/configure — Save WiFi credentials, tear down AP, and reboot */
export async function handleWifiConfigure(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await parseBody(req);
  const { ssid, password, reboot: shouldReboot } = body ?? {};

  if (!ssid || typeof ssid !== 'string') {
    json(res, 400, { error: 'Missing SSID' });
    return;
  }

  const wpaConf = generateWpaSupplicantConf(ssid, password);
  const confPath = `${INSTALL_DIR}/wifi.conf`;

  try {
    // Save WiFi config
    writeFileSync(confPath, wpaConf, { mode: 0o600 });

    // Also copy to system wpa_supplicant location for persistence across reboots
    try {
      writeFileSync('/etc/wpa_supplicant/wpa_supplicant.conf', wpaConf, { mode: 0o600 });
    } catch {
      // May not have permission — wifi.conf will be used by teardown-ap.sh instead
    }

    // Send success response before rebooting
    json(res, 200, {
      success: true,
      message: `WiFi credentials saved for "${ssid}"`,
      rebooting: shouldReboot !== false,
    });

    // Tear down AP and connect to WiFi, then reboot
    // Use setTimeout to allow the HTTP response to be sent first
    setTimeout(async () => {
      try {
        // Run teardown script (stops AP, connects to WiFi)
        const teardownPath = `${INSTALL_DIR}/teardown-ap.sh`;
        try {
          await execFileAsync('bash', [teardownPath], { timeout: 15000 });
        } catch {
          // teardown-ap.sh may not exist on all builds
        }

        // Reboot unless explicitly disabled (e.g., for testing)
        if (shouldReboot !== false) {
          await execFileAsync('reboot', [], { timeout: 5000 }).catch(() => {});
        }
      } catch {
        // Best effort — device may already be rebooting
      }
    }, 1000);
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

// ─── Pairing Code Flow ──────────────────────────────────────────────────

/** Cached pairing code for this wizard session */
let cachedPairingCode: { code: string; expiresAt: string } | null = null;

/** Hardcoded cloud URLs per product — fallback when proxy table lookup fails */
const PRODUCT_CLOUD_URLS: Record<string, string> = {
  safeschool: 'https://safeschoolos.org',
};

/** Resolve the effective product slug, handling 'unified' mode */
function getEffectiveProduct(): string {
  const slug = getProductSlug();
  if (slug === 'unified') {
    // In unified mode, read the product from .env's DASHBOARD_PRODUCT
    const dashProduct = process.env.DASHBOARD_PRODUCT;
    if (dashProduct && PRODUCT_CLOUD_URLS[dashProduct]) return dashProduct;
    // Try reading from .env file directly
    try {
      const envPath = join(process.env.INSTALL_DIR ?? '/opt/edgeruntime', '.env');
      const envContent = readFileSync(envPath, 'utf-8');
      const match = envContent.match(/^DASHBOARD_PRODUCT=(\S+)/m);
      if (match && PRODUCT_CLOUD_URLS[match[1]!]) return match[1]!;
    } catch {}
    // Default to safeschool for unified mode
    return 'safeschool';
  }
  return slug;
}

/** Resolve cloud URL for a specific product */
function getCloudUrlForProduct(product: string): string | null {
  // Try proxy table first
  try {
    const proxyIndex = PRODUCT_PROXY_INDEX[product as keyof typeof PRODUCT_PROXY_INDEX];
    if (proxyIndex !== undefined) {
      const url = resolveProxy(proxyIndex);
      if (url) return url;
    }
  } catch {
    // Proxy table lookup failed — fall through to hardcoded map
  }

  // Fallback to hardcoded URLs
  return PRODUCT_CLOUD_URLS[product] ?? null;
}

/** Get all cloud URLs for pairing (unified mode registers on all backends) */
function getAllCloudUrls(): string[] {
  const slug = getProductSlug();
  if (slug === 'unified') {
    // Register on all main backends so admin can claim from any dashboard
    const products = ['safeschool', 'safeschool', 'safeschool'];
    return products.map(p => getCloudUrlForProduct(p)).filter((u): u is string => u !== null);
  }
  const url = getCloudUrlForProduct(getEffectiveProduct());
  return url ? [url] : [];
}

/** Get device fingerprint: SHA256(product + ':' + firstNonLoopbackMAC) */
function getDeviceFingerprint(): string {
  const product = getEffectiveProduct();
  const nets = networkInterfaces();
  let mac = 'unknown';
  for (const ifaces of Object.values(nets)) {
    if (!ifaces) continue;
    for (const iface of ifaces) {
      if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
        mac = iface.mac;
        break;
      }
    }
    if (mac !== 'unknown') break;
  }
  return createHash('sha256').update(`${product}:${mac}`).digest('hex');
}

/** Cached cloud URLs that successfully registered the pairing code */
let registeredCloudUrls: string[] = [];

/** GET /api/pairing/code — request or return cached pairing code */
export async function handlePairingCode(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Return cached code if still valid
  if (cachedPairingCode && new Date(cachedPairingCode.expiresAt).getTime() > Date.now()) {
    json(res, 200, cachedPairingCode);
    return;
  }

  const cloudUrls = getAllCloudUrls();
  if (cloudUrls.length === 0) {
    json(res, 503, { error: 'Could not resolve cloud URL for this product' });
    return;
  }

  const product = getEffectiveProduct();
  const fingerprint = getDeviceFingerprint();
  let hostname: string;
  try {
    hostname = (await import('node:os')).hostname();
  } catch {
    hostname = 'unknown';
  }

  try {
    // Request pairing code from all cloud backends in parallel
    // The first successful response gives us the code, then we register
    // the same fingerprint on the remaining backends (they'll return the same code
    // due to fingerprint idempotency, or create their own — either way the code
    // shows up in all dashboards)
    const results = await Promise.allSettled(
      cloudUrls.map(async (url) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
          const response = await fetch(`${url}/api/v1/pairing/request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ product, fingerprint, hostname }),
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (!response.ok) return null;
          return { url, data: await response.json() as { code: string; expiresAt: string } };
        } catch {
          clearTimeout(timeout);
          return null;
        }
      }),
    );

    // Collect successful registrations
    let firstResult: { code: string; expiresAt: string } | null = null;
    registeredCloudUrls = [];
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        registeredCloudUrls.push(r.value.url);
        if (!firstResult) firstResult = r.value.data;
      }
    }

    if (!firstResult) {
      json(res, 503, { error: 'Failed to reach any cloud backend' });
      return;
    }

    cachedPairingCode = firstResult;
    json(res, 200, firstResult);
  } catch (err: any) {
    json(res, 503, { error: `Failed to reach cloud: ${err.message}` });
  }
}

/** GET /api/pairing/status — poll cloud for claim, write config if claimed */
export async function handlePairingStatus(
  _req: IncomingMessage,
  res: ServerResponse,
  onShutdown: () => void,
): Promise<void> {
  if (!cachedPairingCode) {
    json(res, 400, { status: 'no_code', error: 'No pairing code requested yet' });
    return;
  }

  if (registeredCloudUrls.length === 0) {
    json(res, 503, { error: 'Could not resolve cloud URL' });
    return;
  }

  try {
    // Poll all registered cloud backends in parallel — first claimed response wins
    const results = await Promise.allSettled(
      registeredCloudUrls.map(async (url) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
          const response = await fetch(`${url}/api/v1/pairing/status/${cachedPairingCode!.code}`, {
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (!response.ok) return null;
          return await response.json() as Record<string, unknown>;
        } catch {
          clearTimeout(timeout);
          return null;
        }
      }),
    );

    // Find the first claimed response, or fall back to any response
    let data: Record<string, unknown> | null = null;
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        if (r.value.status === 'claimed') {
          data = r.value;
          break;
        }
        if (!data) data = r.value;
      }
    }

    if (!data) {
      json(res, 200, { status: 'error', error: 'Could not reach any cloud backend' });
      return;
    }

    if (data.status === 'claimed' && data.activationKey) {
      // Write config from claim response
      const productConfig = getProductConfig();
      const config: WizardConfig = {
        activationKey: data.activationKey as string,
        siteName: data.siteName as string || 'Paired Site',
        orgName: data.orgId as string || 'Auto',
        siteId: data.siteId as string || randomUUID(),
      };

      writeEnvFile(INSTALL_DIR, productConfig.activationKeyEnvVar, config);

      // Write cloud sync key to .env
      if (data.cloudSyncKey) {
        const envPath = join(INSTALL_DIR, '.env');
        if (existsSync(envPath)) {
          let content = readFileSync(envPath, 'utf-8');
          const syncKeyRegex = /^EDGERUNTIME_CLOUD_SYNC_KEY=.*$/m;
          if (syncKeyRegex.test(content)) {
            content = content.replace(syncKeyRegex, `EDGERUNTIME_CLOUD_SYNC_KEY=${data.cloudSyncKey}`);
          } else {
            content += `EDGERUNTIME_CLOUD_SYNC_KEY=${data.cloudSyncKey}\n`;
          }
          writeFileSync(envPath, content, 'utf-8');
        }
      }

      // Write product file and config.yaml
      try {
        const products = data.products as string[] || [];
        const primaryProduct = products[0] || getProductSlug();
        writeFileSync(join(INSTALL_DIR, '.product'), primaryProduct + '\n', { mode: 0o644 });

        const configYaml = [
          'modules:',
          `  - ${primaryProduct}`,
          'operatingMode: EDGE',
          `cloudSyncKey: ${data.cloudSyncKey || randomBytes(32).toString('hex')}`,
          '',
        ].join('\n');
        writeFileSync(join(INSTALL_DIR, 'config.yaml'), configYaml, { mode: 0o644 });

        console.log(`Device paired: ${cachedPairingCode.code} → ${primaryProduct} (site: ${config.siteName})`);
      } catch (err: any) {
        console.warn(`Warning: product config write failed: ${err.message}`);
      }

      await json(res, 200, { status: 'claimed', ...data });
      setTimeout(onShutdown, 100);
      return;
    }

    // Return status as-is (pending or expired)
    await json(res, 200, data);
  } catch (err: any) {
    json(res, 200, { status: 'poll_error', error: err.message });
  }
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
