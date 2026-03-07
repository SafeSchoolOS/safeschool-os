/**
 * Realtime Command Client (Edge Side)
 *
 * Persistent WebSocket connection to the cloud for receiving
 * time-critical commands with sub-5-second delivery:
 *   - Lockdown commands
 *   - Door lock/unlock
 *   - Print jobs
 *   - Emergency alerts
 *   - Access control mode changes
 *
 * Automatically reconnects with exponential backoff.
 * Falls back to HTTP polling if WebSocket is unavailable.
 *
 * Authentication: sends HMAC-signed auth message on connect.
 */

import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { createLogger } from '@edgeruntime/core';

const log = createLogger('realtime-client');

// ─── Types ──────────────────────────────────────────────────────

export interface RealtimeCommand {
  id: string;
  command: string;
  payload: Record<string, unknown>;
  priority: 'critical' | 'high' | 'normal';
  timestamp: string;
  ackTimeoutMs?: number;
}

export type CommandHandler = (command: RealtimeCommand) => Promise<{ status: 'completed' | 'failed'; detail?: string }> | { status: 'completed' | 'failed'; detail?: string };

export interface RealtimeClientConfig {
  /** Cloud sync URL (https://...) - will be converted to wss:// */
  cloudSyncUrl: string;
  /** HMAC sync key */
  syncKey: string;
  /** This device's site ID */
  siteId: string;
  /** Reconnect base delay in ms (default: 1000) */
  reconnectBaseMs?: number;
  /** Max reconnect delay in ms (default: 30000) */
  reconnectMaxMs?: number;
  /** WebSocket path (default: /api/v1/sync/ws) */
  wsPath?: string;
}

// ─── Realtime Client ────────────────────────────────────────────

export class RealtimeClient extends EventEmitter {
  private readonly config: RealtimeClientConfig;
  private readonly wsUrl: string;
  private ws: WebSocket | null = null;
  private authenticated = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private commandHandlers = new Map<string, CommandHandler>();
  private defaultHandler: CommandHandler | null = null;

  constructor(config: RealtimeClientConfig) {
    super();
    this.config = config;

    // Convert https:// to wss:// (or http:// to ws://)
    const wsPath = config.wsPath ?? '/api/v1/sync/ws';
    this.wsUrl = config.cloudSyncUrl
      .replace(/^https:/, 'wss:')
      .replace(/^http:/, 'ws:')
      .replace(/\/+$/, '') + wsPath;
  }

  /**
   * Register a handler for a specific command type.
   * When the cloud sends a command with this name, the handler is called.
   * The handler's return value is sent back as an ack.
   */
  onCommand(commandName: string, handler: CommandHandler): void {
    this.commandHandlers.set(commandName, handler);
  }

  /**
   * Register a default handler for unrecognized commands.
   */
  onAnyCommand(handler: CommandHandler): void {
    this.defaultHandler = handler;
  }

  /**
   * Start the realtime connection.
   */
  start(): void {
    this.stopped = false;
    this.connect();
  }

  /**
   * Stop the realtime connection and don't reconnect.
   */
  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, 'Client stopping');
      this.ws = null;
    }
    this.authenticated = false;
  }

  /**
   * Check if the WebSocket is connected and authenticated.
   */
  isConnected(): boolean {
    return this.authenticated && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Send a real-time event to the cloud (edge -> cloud push).
   * For things like access denied events, alarm triggers, etc.
   */
  sendEvent(eventType: string, data: Record<string, unknown>): boolean {
    if (!this.isConnected()) return false;

    try {
      this.ws!.send(JSON.stringify({
        type: 'event',
        eventType,
        data,
        timestamp: new Date().toISOString(),
      }));
      return true;
    } catch {
      return false;
    }
  }

  // ─── Connection Management ──────────────────────────────────────

  private connect(): void {
    if (this.stopped) return;

    try {
      log.info({ url: this.wsUrl, attempt: this.reconnectAttempt }, 'Connecting to realtime channel');
      this.ws = new WebSocket(this.wsUrl);
    } catch (err) {
      log.error({ err }, 'Failed to create WebSocket');
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      log.info('WebSocket connected, sending auth');
      this.sendAuth();
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(typeof event.data === 'string' ? event.data : '');
    };

    this.ws.onclose = (event) => {
      const wasAuthenticated = this.authenticated;
      this.authenticated = false;
      this.ws = null;

      if (this.stopped) {
        log.info('WebSocket closed (stopped)');
        return;
      }

      log.warn({ code: event.code, reason: event.reason, wasAuthenticated }, 'WebSocket closed');
      this.emit('disconnected', { code: event.code, reason: event.reason });
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire after this, which handles reconnect
      log.error('WebSocket error');
    };
  }

  private sendAuth(): void {
    const timestamp = new Date().toISOString();
    const hmac = crypto
      .createHmac('sha256', this.config.syncKey)
      .update(`${this.config.siteId}.${timestamp}`)
      .digest('hex');

    this.ws!.send(JSON.stringify({
      type: 'auth',
      siteId: this.config.siteId,
      timestamp,
      hmac,
    }));
  }

  private handleMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw);

      switch (msg.type) {
        case 'auth_ok': {
          this.authenticated = true;
          this.reconnectAttempt = 0;
          log.info({ siteId: msg.siteId }, 'Realtime channel authenticated');
          this.emit('connected');
          break;
        }

        case 'command': {
          this.handleCommand(msg as RealtimeCommand).catch((err) => {
            log.error({ err, commandId: msg.id }, 'Command handler error');
          });
          break;
        }

        case 'ping': {
          // Respond with pong
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
          }
          break;
        }

        default:
          log.debug({ type: msg.type }, 'Unknown realtime message');
      }
    } catch (err) {
      log.error({ err }, 'Failed to parse realtime message');
    }
  }

  private async handleCommand(command: RealtimeCommand): Promise<void> {
    log.info({
      commandId: command.id,
      command: command.command,
      priority: command.priority,
    }, 'Received realtime command');

    // Immediately ack receipt
    this.sendAck(command.id, 'received');

    // Emit for any listeners
    this.emit('command', command);

    // Find handler
    const handler = this.commandHandlers.get(command.command) ?? this.defaultHandler;

    if (handler) {
      try {
        this.sendAck(command.id, 'executing');
        const result = await handler(command);
        this.sendAck(command.id, result.status, result.detail);
      } catch (err: any) {
        this.sendAck(command.id, 'failed', err.message || String(err));
      }
    } else {
      log.warn({ command: command.command }, 'No handler registered for command');
      this.sendAck(command.id, 'failed', `No handler for command: ${command.command}`);
    }
  }

  private sendAck(commandId: string, status: string, detail?: string): void {
    if (!this.isConnected()) return;
    try {
      this.ws!.send(JSON.stringify({
        type: 'ack',
        commandId,
        status,
        detail,
        timestamp: new Date().toISOString(),
      }));
    } catch {
      // Connection may have dropped
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;

    const baseMs = this.config.reconnectBaseMs ?? 1000;
    const maxMs = this.config.reconnectMaxMs ?? 30000;
    const delay = Math.min(baseMs * Math.pow(2, this.reconnectAttempt), maxMs);

    // Add jitter (±25%)
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    const actualDelay = Math.round(delay + jitter);

    log.info({ attempt: this.reconnectAttempt, delayMs: actualDelay }, 'Scheduling reconnect');

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempt++;
      this.connect();
    }, actualDelay);
  }
}
