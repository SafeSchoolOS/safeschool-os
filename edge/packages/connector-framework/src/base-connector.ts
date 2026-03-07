/**
 * BaseConnector - unified connector abstraction
 *
 * Merged from GSOC BaseConnector (Python) and SafeSchool connector patterns.
 * TypeScript abstract class that all hardware/API connectors extend.
 */

import { createLogger, ConnectorError } from '@edgeruntime/core';
import type pino from 'pino';

export interface ConnectorConfig {
  enabled: boolean;
  pollIntervalMs: number;
  [key: string]: unknown;
}

export interface ConnectorStatus {
  name: string;
  connected: boolean;
  enabled: boolean;
  lastPollAt: string | null;
  lastEventAt: string | null;
  eventsReceived: number;
  errors: number;
  lastError: string | null;
  pollIntervalMs: number;
}

export type EventHandler = (connectorName: string, events: Record<string, unknown>[]) => void;

export abstract class BaseConnector {
  readonly name: string;
  readonly config: ConnectorConfig;
  protected readonly log: pino.Logger;

  private _connected = false;
  private _lastPollAt: Date | null = null;
  private _lastEventAt: Date | null = null;
  private _eventsReceived = 0;
  private _errors = 0;
  private _lastError: string | null = null;
  private _pollHandle: ReturnType<typeof setInterval> | null = null;
  private _onEvents: EventHandler | null = null;

  constructor(name: string, config: ConnectorConfig) {
    this.name = name;
    this.config = config;
    this.log = createLogger(`connector:${name}`);
  }

  /**
   * Set a callback to receive normalized events from this connector.
   */
  onEvents(handler: EventHandler): void {
    this._onEvents = handler;
  }

  /**
   * Establish connection to the external system.
   */
  abstract connect(): Promise<boolean>;

  /**
   * Close connection to the external system.
   */
  abstract disconnect(): Promise<void>;

  /**
   * Fetch events from the external system.
   */
  abstract fetchEvents(since?: Date): Promise<Record<string, unknown>[]>;

  /**
   * Test connectivity to the external system.
   */
  abstract testConnection(): Promise<boolean>;

  /**
   * Normalize a raw event to the common schema.
   */
  abstract normalizeEvent(rawEvent: Record<string, unknown>): Record<string, unknown>;

  /**
   * Start continuous polling.
   */
  async startPolling(): Promise<void> {
    this.log.info('Starting polling');

    const connected = await this.connect();
    if (!connected) {
      throw new ConnectorError(`Failed to connect to ${this.name}`, this.name);
    }
    this._connected = true;

    this._pollHandle = setInterval(async () => {
      try {
        const events = await this.fetchEvents(this._lastPollAt ?? undefined);
        this._lastPollAt = new Date();

        if (events.length > 0) {
          this._lastEventAt = new Date();
          this._eventsReceived += events.length;

          if (this._onEvents) {
            try {
              // Events are already normalized by fetchEvents() implementations
              this._onEvents(this.name, events);
            } catch (err) {
              this.log.error({ err }, 'Event handler failed');
            }
          }
        }
      } catch (err) {
        this._errors++;
        this._lastError = err instanceof Error ? err.message : String(err);
        this.log.error({ err }, 'Poll failed');
      }
    }, this.config.pollIntervalMs);
  }

  /**
   * Stop continuous polling.
   */
  async stopPolling(): Promise<void> {
    this.log.info('Stopping polling');

    if (this._pollHandle) {
      clearInterval(this._pollHandle);
      this._pollHandle = null;
    }

    if (this._connected) {
      await this.disconnect();
      this._connected = false;
    }
  }

  /**
   * Update status after receiving events.
   */
  protected recordEvents(count: number): void {
    this._eventsReceived += count;
    this._lastEventAt = new Date();
  }

  /**
   * Record an error.
   */
  protected recordError(error: string): void {
    this._errors++;
    this._lastError = error;
    this.log.error({ error }, 'Connector error');
  }

  /**
   * Get current connector status.
   */
  getStatus(): ConnectorStatus {
    return {
      name: this.name,
      connected: this._connected,
      enabled: this.config.enabled,
      lastPollAt: this._lastPollAt?.toISOString() ?? null,
      lastEventAt: this._lastEventAt?.toISOString() ?? null,
      eventsReceived: this._eventsReceived,
      errors: this._errors,
      lastError: this._lastError,
      pollIntervalMs: this.config.pollIntervalMs,
    };
  }
}
