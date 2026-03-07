/**
 * Realtime Command Channel (Cloud Side)
 *
 * WebSocket server that edge devices connect to for instant command delivery.
 * Used for time-critical operations:
 *   - Lockdown commands (< 5s response required)
 *   - Door lock/unlock
 *   - Print jobs
 *   - Emergency alerts
 *   - Access control mode changes
 *
 * The HTTP push/pull/heartbeat protocol remains for bulk data sync.
 * This WebSocket channel is the "fast path" for urgent commands only.
 *
 * Authentication: First message must be { type: 'auth', siteId, syncKey, hmac }
 * After auth, the cloud can push commands instantly to any connected device.
 */

import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { FastifyInstance } from 'fastify';
import { createLogger } from '@edgeruntime/core';

const log = createLogger('realtime-channel');

/** Minimal WebSocket interface (compatible with ws and @fastify/websocket) */
interface WsWebSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: string, listener: (...args: any[]) => void): void;
  readyState: number;
}

// ─── Types ──────────────────────────────────────────────────────

export interface RealtimeCommand {
  id: string;
  command: string;
  payload: Record<string, unknown>;
  priority: 'critical' | 'high' | 'normal';
  timestamp: string;
  /** If set, edge device should ack within this many ms */
  ackTimeoutMs?: number;
}

export interface RealtimeAck {
  commandId: string;
  status: 'received' | 'executing' | 'completed' | 'failed';
  detail?: string;
  timestamp: string;
}

export interface RealtimeEvent {
  type: string;
  siteId: string;
  data: Record<string, unknown>;
  timestamp: string;
}

interface AuthenticatedSocket {
  ws: WsWebSocket;
  siteId: string;
  authenticatedAt: Date;
  lastPingAt: Date;
}

export interface RealtimeChannelOptions {
  /** HMAC key for authenticating WebSocket connections */
  syncKey: string;
  /** Auth timeout in ms (default: 5000) */
  authTimeoutMs?: number;
  /** Ping interval in ms (default: 25000) */
  pingIntervalMs?: number;
  /** How long before a missed pong marks device offline (default: 35000) */
  pongTimeoutMs?: number;
}

// ─── Realtime Channel ───────────────────────────────────────────

export class RealtimeChannel extends EventEmitter {
  private readonly syncKey: string;
  private readonly authTimeoutMs: number;
  private readonly pingIntervalMs: number;
  private readonly pongTimeoutMs: number;

  /** siteId -> socket */
  private connections = new Map<string, AuthenticatedSocket>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  /** Pending ack callbacks: commandId -> { resolve, timer } */
  private pendingAcks = new Map<string, {
    resolve: (ack: RealtimeAck) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(options: RealtimeChannelOptions) {
    super();
    this.syncKey = options.syncKey;
    this.authTimeoutMs = options.authTimeoutMs ?? 5000;
    this.pingIntervalMs = options.pingIntervalMs ?? 25000;
    this.pongTimeoutMs = options.pongTimeoutMs ?? 35000;
  }

  /**
   * Register WebSocket upgrade handler on a Fastify instance.
   * Requires @fastify/websocket plugin.
   */
  register(app: FastifyInstance, path = '/api/v1/sync/ws'): void {
    // Requires @fastify/websocket plugin to be registered on the app.
    // The route handler receives a WebSocket connection object.
    (app as any).get(path, { websocket: true }, (socket: any) => {
      this.handleConnection(socket as WsWebSocket);
    });

    // Start ping/pong keepalive
    this.startPingLoop();

    log.info({ path }, 'Realtime command channel registered');
  }

  /**
   * Send a command to a specific edge device.
   * Returns a promise that resolves when the device acks (or rejects on timeout).
   */
  async sendCommand(siteId: string, command: RealtimeCommand): Promise<RealtimeAck> {
    const conn = this.connections.get(siteId);
    if (!conn) {
      throw new Error(`Device ${siteId} is not connected to realtime channel`);
    }

    const message = JSON.stringify({ type: 'command', ...command });

    return new Promise((resolve, reject) => {
      const ackTimeout = command.ackTimeoutMs ?? 10000;

      const timer = setTimeout(() => {
        this.pendingAcks.delete(command.id);
        reject(new Error(`Command ${command.id} timed out after ${ackTimeout}ms (device: ${siteId})`));
      }, ackTimeout);

      this.pendingAcks.set(command.id, { resolve, timer });

      try {
        conn.ws.send(message);
      } catch (err) {
        clearTimeout(timer);
        this.pendingAcks.delete(command.id);
        reject(new Error(`Failed to send command to ${siteId}: ${err}`));
      }
    });
  }

  /**
   * Fire-and-forget command (no ack waiting). For non-critical pushes.
   */
  sendCommandNoAck(siteId: string, command: RealtimeCommand): boolean {
    const conn = this.connections.get(siteId);
    if (!conn) return false;

    try {
      conn.ws.send(JSON.stringify({ type: 'command', ...command }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Broadcast a command to ALL connected devices.
   * Used for global lockdowns, emergency alerts.
   */
  broadcast(command: RealtimeCommand): number {
    const message = JSON.stringify({ type: 'command', ...command });
    let sent = 0;
    for (const conn of this.connections.values()) {
      try {
        conn.ws.send(message);
        sent++;
      } catch {
        // device will be cleaned up on next ping
      }
    }
    log.info({ commandId: command.id, command: command.command, sent }, 'Broadcast command');
    return sent;
  }

  /**
   * Check if a device is connected to the realtime channel.
   */
  isConnected(siteId: string): boolean {
    return this.connections.has(siteId);
  }

  /**
   * Get list of all connected site IDs.
   */
  getConnectedSites(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Get connection count.
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Disconnect a specific device.
   */
  disconnectDevice(siteId: string): void {
    const conn = this.connections.get(siteId);
    if (conn) {
      conn.ws.close(1000, 'Disconnected by server');
      this.connections.delete(siteId);
    }
  }

  /**
   * Shut down the realtime channel.
   */
  shutdown(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }

    for (const [, { timer }] of this.pendingAcks) {
      clearTimeout(timer);
    }
    this.pendingAcks.clear();

    for (const conn of this.connections.values()) {
      conn.ws.close(1001, 'Server shutting down');
    }
    this.connections.clear();

    log.info('Realtime channel shut down');
  }

  // ─── Connection Handling ────────────────────────────────────────

  private handleConnection(ws: WsWebSocket): void {
    let authenticated = false;
    let siteId: string | null = null;

    // Auth timeout - must authenticate within N ms
    const authTimer = setTimeout(() => {
      if (!authenticated) {
        ws.close(4001, 'Authentication timeout');
      }
    }, this.authTimeoutMs);

    ws.on('message', (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8'));

        if (!authenticated) {
          // First message must be auth
          if (msg.type === 'auth') {
            const valid = this.verifyAuth(msg);
            if (valid) {
              clearTimeout(authTimer);
              authenticated = true;
              siteId = msg.siteId;

              // Close any existing connection for this site (reconnect)
              const existing = this.connections.get(siteId!);
              if (existing) {
                existing.ws.close(4000, 'Replaced by new connection');
              }

              this.connections.set(siteId!, {
                ws,
                siteId: siteId!,
                authenticatedAt: new Date(),
                lastPingAt: new Date(),
              });

              ws.send(JSON.stringify({ type: 'auth_ok', siteId }));
              log.info({ siteId }, 'Device connected to realtime channel');
              this.emit('device:connected', siteId);
            } else {
              ws.close(4003, 'Authentication failed');
            }
          } else {
            ws.close(4002, 'First message must be auth');
          }
          return;
        }

        // Authenticated messages
        switch (msg.type) {
          case 'ack': {
            const pending = this.pendingAcks.get(msg.commandId);
            if (pending) {
              clearTimeout(pending.timer);
              this.pendingAcks.delete(msg.commandId);
              pending.resolve({
                commandId: msg.commandId,
                status: msg.status || 'received',
                detail: msg.detail,
                timestamp: new Date().toISOString(),
              });
            }
            break;
          }
          case 'event': {
            // Edge device pushing a real-time event (e.g., access denied, alarm triggered)
            this.emit('device:event', {
              type: msg.eventType,
              siteId: siteId!,
              data: msg.data || {},
              timestamp: msg.timestamp || new Date().toISOString(),
            } as RealtimeEvent);
            break;
          }
          case 'pong': {
            const conn = this.connections.get(siteId!);
            if (conn) conn.lastPingAt = new Date();
            break;
          }
          default:
            log.warn({ siteId, type: msg.type }, 'Unknown message type');
        }
      } catch (err) {
        log.error({ err, siteId }, 'Failed to process WebSocket message');
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (siteId) {
        this.connections.delete(siteId);
        log.info({ siteId }, 'Device disconnected from realtime channel');
        this.emit('device:disconnected', siteId);
      }
    });

    ws.on('error', (err: unknown) => {
      log.error({ err, siteId }, 'WebSocket error');
    });
  }

  private verifyAuth(msg: { siteId?: string; syncKey?: string; timestamp?: string; hmac?: string }): boolean {
    if (!msg.siteId || !msg.timestamp || !msg.hmac) return false;

    // Verify timestamp is recent (prevent replay)
    const age = Math.abs(Date.now() - new Date(msg.timestamp).getTime());
    if (age > 30_000) return false;

    // Verify HMAC: sign(siteId + timestamp) with syncKey
    const expected = crypto
      .createHmac('sha256', this.syncKey)
      .update(`${msg.siteId}.${msg.timestamp}`)
      .digest('hex');

    const actualBuf = Buffer.from(msg.hmac, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');

    if (actualBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(actualBuf, expectedBuf);
  }

  private startPingLoop(): void {
    this.pingTimer = setInterval(() => {
      const now = Date.now();
      for (const [siteId, conn] of this.connections) {
        // Check if device missed pong
        if (now - conn.lastPingAt.getTime() > this.pongTimeoutMs) {
          log.warn({ siteId }, 'Device missed pong, disconnecting');
          conn.ws.close(4004, 'Pong timeout');
          this.connections.delete(siteId);
          this.emit('device:disconnected', siteId);
          continue;
        }

        try {
          conn.ws.send(JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() }));
        } catch {
          this.connections.delete(siteId);
          this.emit('device:disconnected', siteId);
        }
      }
    }, this.pingIntervalMs);
  }
}
