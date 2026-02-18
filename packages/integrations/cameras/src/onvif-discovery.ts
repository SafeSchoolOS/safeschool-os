/**
 * ONVIF WS-Discovery Helper
 *
 * Sends a WS-Discovery Probe via UDP multicast (239.255.255.250:3702)
 * and collects ProbeMatch responses from ONVIF-compliant cameras on the
 * local network. Each response is parsed to extract the XAddrs (device
 * service URL).
 */

import dgram from 'node:dgram';
import crypto from 'node:crypto';

const WS_DISCOVERY_MULTICAST = '239.255.255.250';
const WS_DISCOVERY_PORT = 3702;
const DEFAULT_TIMEOUT_MS = 5000;

export interface DiscoveredDevice {
  /** ONVIF device service endpoint URL (e.g. http://192.168.1.100/onvif/device_service) */
  serviceUrl: string;
  /** IP address extracted from the service URL */
  ipAddress: string;
  /** Device scopes (manufacturer, model, etc.) */
  scopes: string[];
}

/**
 * Build the WS-Discovery Probe XML message.
 * Targets the ONVIF NetworkVideoTransmitter device type.
 */
function buildProbeMessage(): string {
  const messageId = `urn:uuid:${crypto.randomUUID()}`;
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"',
    '  xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing"',
    '  xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"',
    '  xmlns:dn="http://www.onvif.org/ver10/network/wsdl">',
    '  <s:Header>',
    `    <a:MessageID>${messageId}</a:MessageID>`,
    '    <a:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</a:To>',
    '    <a:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</a:Action>',
    '  </s:Header>',
    '  <s:Body>',
    '    <d:Probe>',
    '      <d:Types>dn:NetworkVideoTransmitter</d:Types>',
    '    </d:Probe>',
    '  </s:Body>',
    '</s:Envelope>',
  ].join('\n');
}

/**
 * Extract XAddrs (service URL) from a ProbeMatch XML response.
 * Uses simple regex parsing to avoid requiring a full XML library.
 */
function parseProbeMatch(xml: string): { serviceUrl: string; scopes: string[] } | null {
  // Extract XAddrs
  const xaddrsMatch = xml.match(/<[\w:]*XAddrs[^>]*>(.*?)<\/[\w:]*XAddrs>/s);
  if (!xaddrsMatch) return null;

  // XAddrs may contain multiple space-separated URLs; take the first HTTP one
  const urls = xaddrsMatch[1].trim().split(/\s+/);
  const serviceUrl = urls.find((u) => u.startsWith('http')) || urls[0];
  if (!serviceUrl) return null;

  // Extract scopes
  const scopesMatch = xml.match(/<[\w:]*Scopes[^>]*>(.*?)<\/[\w:]*Scopes>/s);
  const scopes = scopesMatch ? scopesMatch[1].trim().split(/\s+/) : [];

  return { serviceUrl, scopes };
}

/**
 * Extract IP address from a service URL.
 */
function extractIp(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    // Fallback regex
    const match = url.match(/\/\/([^:/]+)/);
    return match ? match[1] : 'unknown';
  }
}

/**
 * Discover ONVIF cameras on the local network using WS-Discovery.
 *
 * @param timeoutMs  How long to wait for responses (default: 5000ms)
 * @returns Array of discovered device endpoints
 */
export function discoverOnvifDevices(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<DiscoveredDevice[]> {
  return new Promise((resolve) => {
    const devices: DiscoveredDevice[] = [];
    const seen = new Set<string>();

    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    socket.on('message', (msg) => {
      const xml = msg.toString('utf-8');
      const parsed = parseProbeMatch(xml);
      if (!parsed || seen.has(parsed.serviceUrl)) return;

      seen.add(parsed.serviceUrl);
      devices.push({
        serviceUrl: parsed.serviceUrl,
        ipAddress: extractIp(parsed.serviceUrl),
        scopes: parsed.scopes,
      });
    });

    socket.on('error', () => {
      // Silently ignore errors (e.g., no multicast route)
      socket.close();
      resolve(devices);
    });

    socket.bind(0, () => {
      const probe = Buffer.from(buildProbeMessage(), 'utf-8');
      socket.send(probe, 0, probe.length, WS_DISCOVERY_PORT, WS_DISCOVERY_MULTICAST, (err) => {
        if (err) {
          socket.close();
          resolve(devices);
        }
      });
    });

    // Resolve after timeout
    setTimeout(() => {
      try {
        socket.close();
      } catch {
        // Already closed
      }
      resolve(devices);
    }, timeoutMs);
  });
}
