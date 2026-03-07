/**
 * EdgeRuntime Phone Home Client
 *
 * Background heartbeat + fleet management client.
 * TypeScript rewrite of SafeSchool's phone_home.py pattern.
 *
 * Responsibilities:
 * - Periodic heartbeat to cloud with device info
 * - Receive and execute pending commands (license updates, upgrades)
 * - Push analytics snapshots
 * - Hardware ID generation for device identity
 */

import crypto from 'node:crypto';
import os from 'node:os';
import { createLogger } from '@edgeruntime/core';

const log = createLogger('phone-home');

export interface PhoneHomeConfig {
  cloudUrl: string;
  apiKey: string;
  siteId: string;
  heartbeatIntervalMs?: number;
  analyticsIntervalMs?: number;
}

export interface DeviceInfo {
  hardwareId: string;
  hostname: string;
  platform: string;
  arch: string;
  localIp: string;
  uptimeSeconds: number;
  nodeVersion: string;
  memoryTotalMb: number;
  memoryFreeMb: number;
  cpuCount: number;
}

export interface PhoneHomeCommand {
  type: 'license_update' | 'app_update' | 'config_update' | 'restart';
  payload: Record<string, unknown>;
}

export class PhoneHomeClient {
  private readonly config: PhoneHomeConfig;
  private readonly heartbeatInterval: number;
  private readonly analyticsInterval: number;
  private heartbeatHandle: ReturnType<typeof setInterval> | null = null;
  private analyticsHandle: ReturnType<typeof setInterval> | null = null;
  private registered = false;
  private hardwareId: string | null = null;
  private commandHandlers: Map<string, (payload: Record<string, unknown>) => Promise<void>> = new Map();

  constructor(config: PhoneHomeConfig) {
    this.config = config;
    this.heartbeatInterval = config.heartbeatIntervalMs ?? 60_000;
    this.analyticsInterval = config.analyticsIntervalMs ?? 300_000;
  }

  /**
   * Register a handler for a specific command type.
   */
  onCommand(type: string, handler: (payload: Record<string, unknown>) => Promise<void>): void {
    this.commandHandlers.set(type, handler);
  }

  /**
   * Start the phone-home client: register device, then begin heartbeats.
   */
  async start(): Promise<void> {
    log.info('Phone home client starting');

    this.hardwareId = this.getHardwareId();
    log.info({ hardwareId: this.hardwareId }, 'Device hardware ID');

    try {
      await this.registerDevice();
      this.registered = true;
    } catch (err) {
      log.warn({ err }, 'Initial registration failed; will retry on heartbeat');
    }

    this.heartbeatHandle = setInterval(() => {
      this.sendHeartbeat().catch((err) => {
        log.warn({ err }, 'Heartbeat failed');
      });
    }, this.heartbeatInterval);

    this.analyticsHandle = setInterval(() => {
      this.pushAnalytics().catch((err) => {
        log.warn({ err }, 'Analytics push failed');
      });
    }, this.analyticsInterval);

    // Immediate first heartbeat
    this.sendHeartbeat().catch(() => {});
  }

  /**
   * Stop the phone-home client.
   */
  stop(): void {
    if (this.heartbeatHandle) {
      clearInterval(this.heartbeatHandle);
      this.heartbeatHandle = null;
    }
    if (this.analyticsHandle) {
      clearInterval(this.analyticsHandle);
      this.analyticsHandle = null;
    }
    log.info('Phone home client stopped');
  }

  /**
   * Generate a stable hardware ID from network interfaces + hostname.
   */
  getHardwareId(): string {
    const interfaces = os.networkInterfaces();
    let mac = '';
    for (const [, addrs] of Object.entries(interfaces)) {
      if (!addrs) continue;
      for (const addr of addrs) {
        if (!addr.internal && addr.mac && addr.mac !== '00:00:00:00:00:00') {
          mac = addr.mac;
          break;
        }
      }
      if (mac) break;
    }

    const raw = `${mac}:${os.hostname()}`;
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
  }

  /**
   * Get current device info.
   */
  getDeviceInfo(): DeviceInfo {
    return {
      hardwareId: this.hardwareId ?? this.getHardwareId(),
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      localIp: this.getLocalIp(),
      uptimeSeconds: Math.floor(os.uptime()),
      nodeVersion: process.version,
      memoryTotalMb: Math.round(os.totalmem() / 1024 / 1024),
      memoryFreeMb: Math.round(os.freemem() / 1024 / 1024),
      cpuCount: os.cpus().length,
    };
  }

  private getLocalIp(): string {
    const interfaces = os.networkInterfaces();
    for (const [, addrs] of Object.entries(interfaces)) {
      if (!addrs) continue;
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          return addr.address;
        }
      }
    }
    return '127.0.0.1';
  }

  private async registerDevice(): Promise<void> {
    const deviceInfo = this.getDeviceInfo();
    const response = await fetch(`${this.config.cloudUrl}/api/v1/devices/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        siteId: this.config.siteId,
        ...deviceInfo,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Registration failed: HTTP ${response.status}`);
    }

    log.info('Device registered successfully');
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.registered) {
      try {
        await this.registerDevice();
        this.registered = true;
      } catch {
        return;
      }
    }

    const deviceInfo = this.getDeviceInfo();
    const response = await fetch(`${this.config.cloudUrl}/api/v1/devices/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        siteId: this.config.siteId,
        ...deviceInfo,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Heartbeat failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as { commands?: PhoneHomeCommand[] };

    // Process pending commands
    if (data.commands && Array.isArray(data.commands)) {
      for (const cmd of data.commands) {
        const handler = this.commandHandlers.get(cmd.type);
        if (handler) {
          try {
            await handler(cmd.payload);
            log.info({ type: cmd.type }, 'Command executed');
          } catch (err) {
            log.error({ err, type: cmd.type }, 'Command execution failed');
          }
        } else {
          log.warn({ type: cmd.type }, 'No handler for command');
        }
      }
    }
  }

  private async pushAnalytics(): Promise<void> {
    if (!this.registered) return;

    const deviceInfo = this.getDeviceInfo();
    try {
      await fetch(`${this.config.cloudUrl}/api/v1/devices/analytics`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          siteId: this.config.siteId,
          hardwareId: deviceInfo.hardwareId,
          timestamp: new Date().toISOString(),
          metrics: {
            memoryUsedMb: deviceInfo.memoryTotalMb - deviceInfo.memoryFreeMb,
            uptimeSeconds: deviceInfo.uptimeSeconds,
            cpuCount: deviceInfo.cpuCount,
          },
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch (err) {
      log.warn({ err }, 'Analytics push failed');
    }
  }
}
