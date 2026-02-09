import type { FastifyInstance } from 'fastify';
import type { Alert } from '@prisma/client';

// Auto-escalation: if no acknowledgment within this time, escalate
const ESCALATION_TIMEOUT_MS = parseInt(process.env.ESCALATION_TIMEOUT_MS || '60000', 10); // default 60s

// Escalation path: each level escalates to the next
const ESCALATION_PATH: Record<string, string> = {
  MEDICAL: 'LOCKDOWN',
  LOCKDOWN: 'ACTIVE_THREAT',
  // ACTIVE_THREAT doesn't escalate further — it's the highest priority
};

interface CreateAlertInput {
  siteId: string;
  level: string;
  source: string;
  triggeredById: string;
  buildingId: string;
  floor?: number;
  roomId?: string;
  message?: string;
  ipAddress?: string;
}

export class AlertEngine {
  constructor(private app: FastifyInstance) {}

  async createAlert(input: CreateAlertInput): Promise<Alert> {
    // Look up building name (and room if provided) for denormalization
    const building = await this.app.prisma.building.findUniqueOrThrow({
      where: { id: input.buildingId },
    });

    // Look up site GPS coordinates for dispatch location data (Alyssa's Law)
    const site = await this.app.prisma.site.findUniqueOrThrow({
      where: { id: input.siteId },
    });

    let roomName: string | undefined;
    if (input.roomId) {
      const room = await this.app.prisma.room.findUnique({ where: { id: input.roomId } });
      roomName = room?.name;
    }

    // Create alert in DB with denormalized location including GPS
    const alert = await this.app.prisma.alert.create({
      data: {
        siteId: input.siteId,
        level: input.level as any,
        status: 'TRIGGERED',
        source: input.source as any,
        triggeredById: input.triggeredById,
        buildingId: input.buildingId,
        buildingName: building.name,
        floor: input.floor,
        roomId: input.roomId,
        roomName,
        latitude: site.latitude,
        longitude: site.longitude,
        message: input.message,
      },
    });

    // Broadcast via WebSocket
    this.app.wsManager.broadcastToSite(input.siteId, 'alert:created', alert);

    // Enqueue processing jobs (non-blocking — queue failures must not prevent audit logging)
    try {
      await this.enqueueJobs(alert);
    } catch (err) {
      this.app.log.error({ err, alertId: alert.id }, 'Failed to enqueue alert jobs');
    }

    // Audit log
    await this.app.prisma.auditLog.create({
      data: {
        siteId: alert.siteId,
        userId: alert.triggeredById,
        action: 'ALERT_CREATED',
        entity: 'Alert',
        entityId: alert.id,
        details: { level: alert.level, source: alert.source },
        ipAddress: input.ipAddress,
      },
    });

    return alert;
  }

  private async enqueueJobs(alert: Alert): Promise<void> {
    // Always dispatch 911 for threat-level alerts
    const dispatchLevels = ['ACTIVE_THREAT', 'LOCKDOWN', 'FIRE'];
    if (dispatchLevels.includes(alert.level)) {
      await this.app.alertQueue.add('dispatch-911', {
        alertId: alert.id,
        siteId: alert.siteId,
        level: alert.level,
        buildingName: alert.buildingName,
        roomName: alert.roomName,
        floor: alert.floor,
        // GPS coordinates for 911 PSAP (Alyssa's Law location data)
        latitude: alert.latitude,
        longitude: alert.longitude,
      });
    }

    // Auto-lockdown for active threat AND lockdown-level alerts
    const lockdownLevels = ['ACTIVE_THREAT', 'LOCKDOWN'];
    if (lockdownLevels.includes(alert.level)) {
      await this.app.alertQueue.add('auto-lockdown', {
        alertId: alert.id,
        siteId: alert.siteId,
        buildingId: alert.buildingId,
        triggeredById: alert.triggeredById,
      });
    }

    // Notify staff for all alert levels
    await this.app.alertQueue.add('notify-staff', {
      alertId: alert.id,
      siteId: alert.siteId,
      level: alert.level,
      message: alert.message || `${alert.level} alert in ${alert.buildingName}${alert.roomName ? ` - ${alert.roomName}` : ''}`,
    });

    // Auto-escalation: if alert isn't acknowledged within timeout, escalate
    const nextLevel = ESCALATION_PATH[alert.level];
    if (nextLevel) {
      await this.app.alertQueue.add(
        'auto-escalate',
        {
          alertId: alert.id,
          siteId: alert.siteId,
          currentLevel: alert.level,
          nextLevel,
          buildingId: alert.buildingId,
          triggeredById: alert.triggeredById,
        },
        { delay: ESCALATION_TIMEOUT_MS },
      );
    }
  }

  async acknowledgeAlert(alertId: string, userId: string, ipAddress?: string): Promise<Alert> {
    const alert = await this.app.prisma.alert.update({
      where: { id: alertId },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedById: userId,
        acknowledgedAt: new Date(),
      },
    });

    this.app.wsManager.broadcastToSite(alert.siteId, 'alert:updated', alert);

    await this.app.prisma.auditLog.create({
      data: {
        siteId: alert.siteId,
        userId,
        action: 'ALERT_ACKNOWLEDGED',
        entity: 'Alert',
        entityId: alert.id,
        ipAddress,
      },
    });

    return alert;
  }

  async resolveAlert(alertId: string, userId: string, ipAddress?: string): Promise<Alert> {
    const alert = await this.app.prisma.alert.update({
      where: { id: alertId },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
      },
    });

    this.app.wsManager.broadcastToSite(alert.siteId, 'alert:updated', alert);

    await this.app.prisma.auditLog.create({
      data: {
        siteId: alert.siteId,
        userId,
        action: 'ALERT_RESOLVED',
        entity: 'Alert',
        entityId: alert.id,
        ipAddress,
      },
    });

    return alert;
  }

  async escalateAlert(alertId: string, nextLevel: string): Promise<Alert | null> {
    // Only escalate if the alert hasn't been acknowledged yet
    const existing = await this.app.prisma.alert.findUnique({ where: { id: alertId } });
    if (!existing || existing.status !== 'TRIGGERED') {
      // Already acknowledged, dispatched, resolved, or cancelled — don't escalate
      return null;
    }

    const alert = await this.app.prisma.alert.update({
      where: { id: alertId },
      data: {
        level: nextLevel as any,
        message: `${existing.message || ''} [AUTO-ESCALATED from ${existing.level}]`.trim(),
      },
    });

    this.app.wsManager.broadcastToSite(alert.siteId, 'alert:escalated', alert);

    await this.app.prisma.auditLog.create({
      data: {
        siteId: alert.siteId,
        action: 'ALERT_ESCALATED',
        entity: 'Alert',
        entityId: alert.id,
        details: { from: existing.level, to: nextLevel, reason: 'auto-escalation timeout' },
      },
    });

    // Re-enqueue jobs for the escalated level (e.g., now triggers lockdown or dispatch)
    await this.enqueueJobs(alert);

    return alert;
  }

  async cancelAlert(alertId: string, userId: string, ipAddress?: string): Promise<Alert> {
    const alert = await this.app.prisma.alert.update({
      where: { id: alertId },
      data: { status: 'CANCELLED' },
    });

    this.app.wsManager.broadcastToSite(alert.siteId, 'alert:updated', alert);

    await this.app.prisma.auditLog.create({
      data: {
        siteId: alert.siteId,
        userId,
        action: 'ALERT_CANCELLED',
        entity: 'Alert',
        entityId: alert.id,
        ipAddress,
      },
    });

    return alert;
  }
}
