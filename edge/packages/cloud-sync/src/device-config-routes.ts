/**
 * Device Config Routes
 *
 * REST API for remotely managing edge device settings from the cloud dashboard.
 * Settings are delivered to edge devices via heartbeat responses.
 *
 * Endpoints:
 *   GET  /api/v1/devices/:siteId/config   — Get current config for a device
 *   PUT  /api/v1/devices/:siteId/config   — Update config for a device
 *   POST /api/v1/devices/:siteId/command  — Send a command to a device
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';
import type { SyncDatabaseAdapter, ConnectorConfigEntry, DeviceCommand } from './types.js';

const log = createLogger('cloud-sync:device-config');

export interface DeviceConfigRoutesOptions {
  adapter: SyncDatabaseAdapter;
}

export async function deviceConfigRoutes(fastify: FastifyInstance, options: DeviceConfigRoutesOptions) {
  const { adapter } = options;

  // GET /devices/:siteId/config
  fastify.get('/devices/:siteId/config', async (request: FastifyRequest, reply: FastifyReply) => {
    const { siteId } = request.params as { siteId: string };

    const device = await adapter.getDevice(siteId);
    if (!device) {
      return reply.code(404).send({ error: 'Device not found' });
    }

    const config = await adapter.getDeviceConfig(siteId);
    return reply.send({
      siteId,
      hostname: device.hostname,
      version: device.version,
      mode: device.mode,
      config: config?.config ?? null,
      appliedVersion: config?.appliedVersion ?? null,
      updatedAt: config?.updatedAt?.toISOString() ?? null,
    });
  });

  // PUT /devices/:siteId/config
  fastify.put('/devices/:siteId/config', async (request: FastifyRequest, reply: FastifyReply) => {
    const { siteId } = request.params as { siteId: string };
    const body = request.body as Record<string, unknown>;

    const device = await adapter.getDevice(siteId);
    if (!device) {
      return reply.code(404).send({ error: 'Device not found' });
    }

    // Validate connectors if provided
    if (body.connectors !== undefined) {
      if (!Array.isArray(body.connectors)) {
        return reply.code(400).send({ error: 'connectors must be an array' });
      }
      for (const c of body.connectors as ConnectorConfigEntry[]) {
        if (!c.name || !c.type) {
          return reply.code(400).send({ error: 'Each connector must have name and type' });
        }
      }
    }

    // Validate syncIntervalMs
    if (body.syncIntervalMs !== undefined) {
      const interval = Number(body.syncIntervalMs);
      if (isNaN(interval) || interval < 5000 || interval > 3600000) {
        return reply.code(400).send({ error: 'syncIntervalMs must be between 5000 and 3600000' });
      }
    }

    // Build config payload (only include fields that were provided)
    const configUpdate: Record<string, unknown> = {};
    if (body.connectors !== undefined) configUpdate.connectors = body.connectors;
    if (body.syncIntervalMs !== undefined) configUpdate.syncIntervalMs = Number(body.syncIntervalMs);
    if (body.siteName !== undefined) configUpdate.siteName = String(body.siteName);
    if (body.federation !== undefined) configUpdate.federation = body.federation;

    const record = await adapter.setDeviceConfig(siteId, configUpdate);
    log.info({ siteId, version: record.config.version }, 'Device config updated');

    return reply.send({
      siteId,
      config: record.config,
      appliedVersion: record.appliedVersion ?? null,
      updatedAt: record.updatedAt.toISOString(),
    });
  });

  // POST /devices/:siteId/command
  fastify.post('/devices/:siteId/command', async (request: FastifyRequest, reply: FastifyReply) => {
    const { siteId } = request.params as { siteId: string };
    const body = request.body as { action: string };

    const device = await adapter.getDevice(siteId);
    if (!device) {
      return reply.code(404).send({ error: 'Device not found' });
    }

    const validActions = ['restart', 'reboot', 'clear_cache', 'rotate_logs'];
    if (!body.action || !validActions.includes(body.action)) {
      return reply.code(400).send({ error: `action must be one of: ${validActions.join(', ')}` });
    }

    const command: DeviceCommand = {
      id: `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      action: body.action as DeviceCommand['action'],
      issuedAt: new Date().toISOString(),
    };

    // Add command to device config
    const existing = await adapter.getDeviceConfig(siteId);
    const commands = [...(existing?.config.commands ?? []), command];
    await adapter.setDeviceConfig(siteId, { commands });

    log.info({ siteId, action: body.action, commandId: command.id }, 'Command queued for device');

    return reply.send({ queued: true, command });
  });

  // GET /devices — list all devices with their config status
  fastify.get('/devices', async (request: FastifyRequest, reply: FastifyReply) => {
    const devices = await adapter.listDevices();
    const result = await Promise.all(devices.map(async (device) => {
      const config = await adapter.getDeviceConfig(device.siteId);
      return {
        siteId: device.siteId,
        hostname: device.hostname,
        ipAddress: device.ipAddress,
        version: device.version,
        mode: device.mode,
        lastHeartbeatAt: device.lastHeartbeatAt.toISOString(),
        configVersion: config?.config.version ?? null,
        appliedVersion: config?.appliedVersion ?? null,
        configPending: config ? (config.config.version !== config.appliedVersion) : false,
      };
    }));
    return reply.send({ devices: result });
  });
}
