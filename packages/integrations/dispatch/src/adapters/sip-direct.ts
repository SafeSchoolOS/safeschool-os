import type { DispatchAdapter, DispatchPayload, DispatchResult } from '../index.js';
import { generatePidfLo } from '../nena-i3.js';
import type { CivicAddress, GeoCoordinates, CallerInfo } from '../nena-i3.js';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface SipDirectConfig {
  /** SIP trunk host (IP or hostname) */
  trunkHost: string;
  /** SIP trunk port (default 5060) */
  trunkPort?: number;
  /** Transport protocol (default 'TCP') */
  transport?: 'TCP' | 'UDP';
  /** Local SIP domain / realm */
  localDomain: string;
  /** SIP From user (caller ID) */
  fromUser: string;
  /** SIP To URI (e.g. urn:service:sos or specific PSAP SIP URI) */
  toUri?: string;
  /** Socket connection timeout in ms (default 10000) */
  connectionTimeoutMs?: number;
  /** Optional SIP auth username */
  authUsername?: string;
  /** Optional SIP auth password */
  authPassword?: string;
}

// ---------------------------------------------------------------------------
// SIP message helpers
// ---------------------------------------------------------------------------

/** Generate a random SIP Call-ID using cryptographic randomness. */
function generateCallId(domain: string): string {
  const random = crypto.randomBytes(12).toString('hex');
  return `${random}@${domain}`;
}

/** Generate a random SIP branch parameter using cryptographic randomness. */
function generateBranch(): string {
  return 'z9hG4bK' + crypto.randomBytes(8).toString('hex');
}

/** Generate a random SIP tag using cryptographic randomness. */
function generateTag(): string {
  return crypto.randomBytes(6).toString('hex');
}

/** Build a SIP INVITE message with PIDF-LO body for NG 911. */
export function buildSipInvite(opts: {
  callId: string;
  fromUser: string;
  fromDomain: string;
  fromTag: string;
  toUri: string;
  trunkHost: string;
  trunkPort: number;
  branch: string;
  pidfLo: string;
  transport: 'TCP' | 'UDP';
}): string {
  const cseq = 1;
  const contentType = 'application/pidf+xml';
  const bodyBytes = Buffer.byteLength(opts.pidfLo, 'utf-8');

  const lines = [
    `INVITE ${opts.toUri} SIP/2.0`,
    `Via: SIP/2.0/${opts.transport} ${opts.fromDomain};branch=${opts.branch};rport`,
    `Max-Forwards: 70`,
    `From: <sip:${opts.fromUser}@${opts.fromDomain}>;tag=${opts.fromTag}`,
    `To: <${opts.toUri}>`,
    `Call-ID: ${opts.callId}`,
    `CSeq: ${cseq} INVITE`,
    `Contact: <sip:${opts.fromUser}@${opts.fromDomain}>`,
    `Content-Type: ${contentType}`,
    `Content-Length: ${bodyBytes}`,
    `Geolocation: <cid:safeschool-loc@${opts.fromDomain}>`,
    `Geolocation-Routing: yes`,
    `Accept: application/sdp, application/pidf+xml`,
    `Priority: emergency`,
    ``, // blank line before body
    opts.pidfLo,
  ];

  return lines.join('\r\n');
}

/** Parse a SIP response and return status code + reason. */
export function parseSipResponse(raw: string): { statusCode: number; reason: string } {
  // First line format: SIP/2.0 <code> <reason>
  const firstLine = raw.split('\r\n')[0] || raw.split('\n')[0] || '';
  const match = firstLine.match(/^SIP\/2\.0\s+(\d{3})\s+(.*)$/);
  if (!match) {
    return { statusCode: 0, reason: 'Unparseable SIP response' };
  }
  return { statusCode: parseInt(match[1], 10), reason: match[2].trim() };
}

// ---------------------------------------------------------------------------
// Socket abstraction (allows injection for testing)
// ---------------------------------------------------------------------------

export interface SipSocket {
  connect(host: string, port: number, timeoutMs: number): Promise<void>;
  send(data: string): Promise<void>;
  receive(timeoutMs: number): Promise<string>;
  close(): Promise<void>;
}

/**
 * Default TCP/UDP socket implementation using Node.js net module.
 * This serves as the production implementation; tests inject a mock.
 */
export class NodeSipSocket implements SipSocket {
  private transport: 'TCP' | 'UDP';

  constructor(transport: 'TCP' | 'UDP') {
    this.transport = transport;
  }

  async connect(host: string, port: number, timeoutMs: number): Promise<void> {
    if (this.transport === 'TCP') {
      const net = await import('node:net');
      const socket = net.createConnection({ host, port });

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          socket.destroy();
          reject(new Error(`TCP connection to ${host}:${port} timed out`));
        }, timeoutMs);

        socket.on('connect', () => {
          clearTimeout(timer);
          (this as any)._socket = socket;
          resolve();
        });
        socket.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
    } else {
      const dgram = await import('node:dgram');
      const socket = dgram.createSocket('udp4');
      (this as any)._socket = socket;
      (this as any)._host = host;
      (this as any)._port = port;
    }
  }

  async send(data: string): Promise<void> {
    const socket = (this as any)._socket;
    if (!socket) throw new Error('Socket not connected');

    if (this.transport === 'TCP') {
      await new Promise<void>((resolve, reject) => {
        socket.write(data, 'utf-8', (err: Error | undefined) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } else {
      const host = (this as any)._host;
      const port = (this as any)._port;
      await new Promise<void>((resolve, reject) => {
        socket.send(data, port, host, (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  async receive(timeoutMs: number): Promise<string> {
    const socket = (this as any)._socket;
    if (!socket) throw new Error('Socket not connected');

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('SIP response timed out'));
      }, timeoutMs);

      const event = this.transport === 'TCP' ? 'data' : 'message';
      socket.once(event, (data: Buffer) => {
        clearTimeout(timer);
        resolve(data.toString('utf-8'));
      });
    });
  }

  async close(): Promise<void> {
    const socket = (this as any)._socket;
    if (!socket) return;

    if (this.transport === 'TCP') {
      socket.destroy();
    } else {
      socket.close();
    }
    (this as any)._socket = null;
  }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * SIP Direct Dispatch Adapter
 *
 * Creates a SIP INVITE message with PIDF-LO body and sends it to
 * a configured SIP trunk. Used for direct NG 911 dispatch via SIP
 * when a SIP trunk to the local PSAP is available.
 */
export class SipDirectAdapter implements DispatchAdapter {
  name = 'SIP Direct';

  private config: SipDirectConfig;
  private socketFactory: () => SipSocket;

  constructor(config: SipDirectConfig, socketFactory?: () => SipSocket) {
    this.config = {
      trunkPort: 5060,
      transport: 'TCP',
      connectionTimeoutMs: 10_000,
      toUri: 'urn:service:sos',
      ...config,
    };
    this.socketFactory =
      socketFactory ?? (() => new NodeSipSocket(this.config.transport!));
  }

  // -----------------------------------------------------------------------
  // DispatchAdapter interface
  // -----------------------------------------------------------------------

  async dispatch(alert: DispatchPayload): Promise<DispatchResult> {
    const start = Date.now();
    let socket: SipSocket | null = null;

    try {
      // Build PIDF-LO
      const civic = this.buildCivicAddress(alert);
      const geo: GeoCoordinates = {
        latitude: alert.latitude ?? 0,
        longitude: alert.longitude ?? 0,
      };
      const caller: CallerInfo | undefined = alert.callerInfo
        ? { name: alert.callerInfo }
        : undefined;

      const pidfLo = generatePidfLo({
        alertId: alert.alertId,
        civic,
        geo,
        caller,
      });

      // Build SIP INVITE
      const callId = generateCallId(this.config.localDomain);
      const branch = generateBranch();
      const fromTag = generateTag();

      const invite = buildSipInvite({
        callId,
        fromUser: this.config.fromUser,
        fromDomain: this.config.localDomain,
        fromTag,
        toUri: this.config.toUri!,
        trunkHost: this.config.trunkHost,
        trunkPort: this.config.trunkPort!,
        branch,
        pidfLo,
        transport: this.config.transport!,
      });

      // Send via socket
      socket = this.socketFactory();
      await socket.connect(
        this.config.trunkHost,
        this.config.trunkPort!,
        this.config.connectionTimeoutMs!,
      );
      await socket.send(invite);

      // Wait for response
      const raw = await socket.receive(this.config.connectionTimeoutMs!);
      const { statusCode, reason } = parseSipResponse(raw);

      const success = statusCode >= 100 && statusCode < 300;

      return {
        success,
        dispatchId: callId,
        method: 'SIP_DIRECT',
        responseTimeMs: Date.now() - start,
        error: success ? undefined : `SIP ${statusCode} ${reason}`,
      };
    } catch (err) {
      return {
        success: false,
        dispatchId: '',
        method: 'SIP_DIRECT',
        responseTimeMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      if (socket) {
        await socket.close().catch(() => {});
      }
    }
  }

  async getStatus(_dispatchId: string): Promise<string> {
    // SIP is fire-and-forget after the initial INVITE response.
    // Status tracking relies on SIP dialog events which require a persistent
    // SIP UA — beyond the scope of this adapter. Return a static status.
    return 'SENT';
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private buildCivicAddress(alert: DispatchPayload): CivicAddress {
    return {
      country: 'US',
      state: '',
      city: '',
      street: alert.buildingName,
      houseNumber: '',
      zip: '',
      floor: alert.floor,
      room: alert.roomName,
      building: alert.buildingName,
    };
  }
}
