import type { FastifyInstance } from 'fastify';
import type { Alert } from '@prisma/client';

// Auto-escalation: if no acknowledgment within this time, escalate
const ESCALATION_TIMEOUT_MS = parseInt(process.env.ESCALATION_TIMEOUT_MS || '60000', 10); // default 60s

// NFPA 72 Positive Alarm Sequence timing
const PAS_ACK_WINDOW_MS = 15_000;        // 15 seconds to acknowledge
const PAS_INVESTIGATION_WINDOW_MS = 180_000; // 3 minutes to investigate

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
  trainingMode?: boolean;
  // Fire alarm PAS fields
  fireAlarmZoneId?: string;
  fireDeviceType?: string;
}

/**
 * Classify suspicion level based on fire alarm device type and context.
 *
 * Per NFPA 3000 / IAFC / Colorado DFPC research:
 * - Manual pull station during lockdown = HIGH (likely attacker ruse)
 * - Smoke detector near threat zone = MODERATE (likely gunfire smoke/dust)
 * - Heat detector or waterflow = ELEVATED (possible real fire)
 * - Smoke detector away from threat = LOW (investigate immediately)
 */
function classifySuspicion(
  deviceType: string,
  _zoneNearThreat: boolean,
): string {
  switch (deviceType) {
    case 'MANUAL_PULL_STATION':
      return 'HIGH_SUSPICION';
    case 'HEAT_DETECTOR':
    case 'SPRINKLER_WATERFLOW':
      return 'ELEVATED_SUSPICION';
    case 'SMOKE_DETECTOR':
      return _zoneNearThreat ? 'MODERATE_SUSPICION' : 'LOW_SUSPICION';
    case 'DUCT_DETECTOR':
      return 'LOW_SUSPICION';
    default:
      return 'UNKNOWN_SUSPICION';
  }
}

function suspicionLabel(level: string): string {
  const labels: Record<string, string> = {
    HIGH_SUSPICION: 'HIGH SUSPICION — Manual pull station (possible attacker ruse)',
    ELEVATED_SUSPICION: 'ELEVATED — Heat/waterflow detected (possible real fire)',
    MODERATE_SUSPICION: 'MODERATE — Smoke near threat zone (likely gunfire smoke)',
    LOW_SUSPICION: 'LOW — Smoke away from threat zone (investigate immediately)',
    UNKNOWN_SUSPICION: 'UNKNOWN — Assess situation',
  };
  return labels[level] || level;
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

    const isTraining = input.trainingMode === true;

    // -----------------------------------------------------------------------
    // NFPA 72 Positive Alarm Sequence — Fire During Lockdown
    //
    // When a FIRE alert triggers during an active LOCKDOWN or ACTIVE_THREAT:
    // 1. SUPPRESS the fire alarm (do NOT unlock doors)
    // 2. Start 15-second acknowledgment window
    // 3. On acknowledgment, start 3-minute investigation window
    // 4. Auto-escalate if not acknowledged in 15s
    // 5. Classify suspicion based on device type (pull station vs smoke vs heat)
    // 6. Operator must decide: EVACUATE / MAINTAIN_LOCKDOWN / EXTEND
    //
    // References: NFPA 3000, NFPA 72 PAS, Parkland lessons, IAFC, Colorado DFPC
    // -----------------------------------------------------------------------
    let isSuppressed = false;
    let activeLockdownAlert: Alert | null = null;
    let suspicionLevel = 'UNKNOWN_SUSPICION';

    if (input.level === 'FIRE') {
      activeLockdownAlert = await this.app.prisma.alert.findFirst({
        where: {
          siteId: input.siteId,
          level: { in: ['LOCKDOWN', 'ACTIVE_THREAT'] },
          status: { in: ['TRIGGERED', 'ACKNOWLEDGED', 'DISPATCHED', 'RESPONDING'] },
        },
        orderBy: { triggeredAt: 'desc' },
      });

      if (activeLockdownAlert) {
        isSuppressed = true;

        // Classify suspicion level based on device type
        const deviceType = input.fireDeviceType || 'UNKNOWN_DEVICE';
        // TODO: In future, check if the fire zone is near the threat zone using
        // building/floor proximity. For now, treat smoke detectors as moderate
        // (same building as lockdown = near threat).
        const zoneNearThreat = true;
        suspicionLevel = classifySuspicion(deviceType, zoneNearThreat);

        this.app.log.warn(
          {
            siteId: input.siteId,
            lockdownAlertId: activeLockdownAlert.id,
            deviceType,
            suspicionLevel,
          },
          'FIRE alarm SUPPRESSED — active lockdown in progress. PAS protocol initiated.',
        );
      }
    }

    // Create alert in DB with denormalized location including GPS
    const alert = await this.app.prisma.alert.create({
      data: {
        siteId: input.siteId,
        level: input.level as any,
        status: isSuppressed ? 'SUPPRESSED' : 'TRIGGERED',
        source: input.source as any,
        triggeredById: input.triggeredById,
        buildingId: input.buildingId,
        buildingName: building.name,
        floor: input.floor,
        roomId: input.roomId,
        roomName,
        latitude: site.latitude,
        longitude: site.longitude,
        message: isTraining
          ? `[TRAINING] ${input.message || ''}`.trim()
          : isSuppressed
            ? `[SUPPRESSED] Fire alarm during active lockdown — ${suspicionLabel(suspicionLevel)}. ${input.message || ''}`.trim()
            : input.message,
        metadata: {
          ...(isTraining ? { trainingMode: true } : {}),
          ...(isSuppressed ? {
            suppressed: true,
            suppressedReason: 'fire_during_lockdown',
            activeLockdownAlertId: activeLockdownAlert!.id,
            suppressedAt: new Date().toISOString(),
            awaitingDecision: true,
            pasProtocol: {
              ackDeadline: new Date(Date.now() + PAS_ACK_WINDOW_MS).toISOString(),
              investigationDeadline: null, // Set when acknowledged
              deviceType: input.fireDeviceType || 'UNKNOWN_DEVICE',
              suspicionLevel,
              fireAlarmZoneId: input.fireAlarmZoneId || null,
            },
          } : {}),
        } as any,
      },
    });

    // Create FireAlarmEvent record for tracking PAS timeline
    if (isSuppressed) {
      const ackDeadline = new Date(Date.now() + PAS_ACK_WINDOW_MS);

      await this.app.prisma.fireAlarmEvent.create({
        data: {
          siteId: input.siteId,
          alertId: alert.id,
          fireAlarmZoneId: input.fireAlarmZoneId || null,
          deviceType: (input.fireDeviceType || 'UNKNOWN_DEVICE') as any,
          status: 'ALARM_ACTIVE',
          suspicionLevel: suspicionLevel as any,
          activeLockdownId: activeLockdownAlert!.id,
          metadata: {
            buildingName: building.name,
            floor: input.floor,
            ackDeadline: ackDeadline.toISOString(),
          },
        },
      });

      // Schedule auto-escalation if not acknowledged within 15 seconds
      await this.app.alertQueue.add(
        'fire-pas-auto-escalate',
        {
          alertId: alert.id,
          siteId: input.siteId,
          reason: 'PAS acknowledgment timeout (15s)',
        },
        { delay: PAS_ACK_WINDOW_MS },
      );
    }

    // Broadcast via WebSocket
    this.app.wsManager.broadcastToSite(input.siteId, 'alert:created', alert);

    if (isSuppressed) {
      // Broadcast PAS fire-suppression event
      this.app.wsManager.broadcastToSite(input.siteId, 'fire-alarm:suppressed', {
        fireAlertId: alert.id,
        lockdownAlertId: activeLockdownAlert!.id,
        buildingName: building.name,
        deviceType: input.fireDeviceType || 'UNKNOWN_DEVICE',
        suspicionLevel,
        suspicionLabel: suspicionLabel(suspicionLevel),
        ackDeadlineMs: PAS_ACK_WINDOW_MS,
        investigationWindowMs: PAS_INVESTIGATION_WINDOW_MS,
        message: `Fire alarm triggered during active lockdown — doors remain LOCKED. PAS protocol: ${suspicionLabel(suspicionLevel)}`,
      });

      // Notify staff about the suppressed fire alarm
      await this.app.alertQueue.add('notify-staff', {
        alertId: alert.id,
        siteId: alert.siteId,
        level: 'FIRE',
        message: `FIRE ALARM SUPPRESSED (PAS) in ${building.name}. ${suspicionLabel(suspicionLevel)}. Acknowledge within 15 seconds, then investigate within 3 minutes.`,
      });
    } else {
      // Normal flow — enqueue processing jobs
      try {
        await this.enqueueJobs(alert, isTraining);
      } catch (err) {
        this.app.log.error({ err, alertId: alert.id }, 'Failed to enqueue alert jobs');
      }
    }

    // Audit log
    await this.app.prisma.auditLog.create({
      data: {
        siteId: alert.siteId,
        userId: alert.triggeredById,
        action: isSuppressed ? 'FIRE_ALARM_SUPPRESSED' : 'ALERT_CREATED',
        entity: 'Alert',
        entityId: alert.id,
        details: {
          level: alert.level,
          source: alert.source,
          ...(isSuppressed ? {
            suppressedReason: 'fire_during_lockdown',
            activeLockdownAlertId: activeLockdownAlert!.id,
            suspicionLevel,
            deviceType: input.fireDeviceType,
          } : {}),
        },
        ipAddress: input.ipAddress,
      },
    });

    return alert;
  }

  /**
   * Acknowledge a suppressed fire alarm — starts the 3-minute investigation window.
   * NFPA 72 PAS: must be acknowledged within 15 seconds.
   */
  async acknowledgeFire(alertId: string, userId: string, ipAddress?: string): Promise<Alert> {
    const existing = await this.app.prisma.alert.findUniqueOrThrow({ where: { id: alertId } });

    if (existing.status !== 'SUPPRESSED' || existing.level !== 'FIRE') {
      throw new Error('Alert is not a suppressed fire alarm');
    }

    const investigationDeadline = new Date(Date.now() + PAS_INVESTIGATION_WINDOW_MS);

    // Update alert metadata with investigation window
    const metadata = (existing.metadata as any) || {};
    const alert = await this.app.prisma.alert.update({
      where: { id: alertId },
      data: {
        acknowledgedById: userId,
        acknowledgedAt: new Date(),
        message: `[INVESTIGATING] Fire alarm acknowledged — investigation in progress. ${suspicionLabel(metadata.pasProtocol?.suspicionLevel || 'UNKNOWN_SUSPICION')}`,
        metadata: {
          ...metadata,
          pasProtocol: {
            ...metadata.pasProtocol,
            acknowledged: true,
            acknowledgedAt: new Date().toISOString(),
            acknowledgedBy: userId,
            investigationDeadline: investigationDeadline.toISOString(),
          },
        },
      },
    });

    // Update FireAlarmEvent
    await this.app.prisma.fireAlarmEvent.updateMany({
      where: { alertId, status: 'ALARM_ACTIVE' },
      data: {
        status: 'INVESTIGATING',
        acknowledgedAt: new Date(),
        acknowledgedById: userId,
        investigationEndsAt: investigationDeadline,
      },
    });

    // Schedule auto-escalation at end of 3-minute window
    await this.app.alertQueue.add(
      'fire-pas-investigation-timeout',
      {
        alertId: alert.id,
        siteId: alert.siteId,
        investigationDeadline: investigationDeadline.toISOString(),
      },
      { delay: PAS_INVESTIGATION_WINDOW_MS },
    );

    // Broadcast investigation started
    this.app.wsManager.broadcastToSite(alert.siteId, 'fire-alarm:investigating', {
      fireAlertId: alert.id,
      acknowledgedBy: userId,
      investigationDeadline: investigationDeadline.toISOString(),
      investigationWindowMs: PAS_INVESTIGATION_WINDOW_MS,
      message: 'Fire alarm acknowledged. 3-minute investigation window started. Dispatch investigator to fire zone.',
    });

    // Audit log
    await this.app.prisma.auditLog.create({
      data: {
        siteId: alert.siteId,
        userId,
        action: 'FIRE_ALARM_ACKNOWLEDGED_PAS',
        entity: 'Alert',
        entityId: alert.id,
        details: {
          investigationDeadline: investigationDeadline.toISOString(),
          suspicionLevel: metadata.pasProtocol?.suspicionLevel,
        },
        ipAddress,
      },
    });

    return alert;
  }

  /**
   * Confirm a suppressed fire alarm as a REAL fire — initiates evacuation.
   * Unlocks all non-emergency doors, dispatches fire department, notifies all staff.
   * Only OPERATOR+ should call this.
   */
  async confirmFire(
    alertId: string,
    userId: string,
    options?: { directedEvacuation?: boolean; evacuateZones?: string[]; avoidZones?: string[] },
    ipAddress?: string,
  ): Promise<Alert> {
    const existing = await this.app.prisma.alert.findUniqueOrThrow({ where: { id: alertId } });

    if (existing.status !== 'SUPPRESSED' || existing.level !== 'FIRE') {
      throw new Error('Alert is not a suppressed fire alarm');
    }

    const isDirected = options?.directedEvacuation === true && options.evacuateZones?.length;
    const decision = isDirected ? 'EVACUATE_DIRECTED' : 'EVACUATE_ALL';

    // Transition to TRIGGERED — this will now proceed with full fire response
    const alert = await this.app.prisma.alert.update({
      where: { id: alertId },
      data: {
        status: 'TRIGGERED',
        message: `[CONFIRMED FIRE] ${(existing.message || '').replace(/\[SUPPRESSED\]|\[INVESTIGATING\]/g, '')}`.trim(),
        metadata: {
          ...(existing.metadata as any || {}),
          suppressed: false,
          awaitingDecision: false,
          confirmedFireAt: new Date().toISOString(),
          confirmedFireBy: userId,
          evacuationType: decision,
          evacuateZones: options?.evacuateZones || null,
          avoidZones: options?.avoidZones || null,
        },
      },
    });

    // Update FireAlarmEvent
    await this.app.prisma.fireAlarmEvent.updateMany({
      where: { alertId, status: { in: ['ALARM_ACTIVE', 'ACKNOWLEDGED_ALARM', 'INVESTIGATING'] } },
      data: {
        status: 'CONFIRMED_FIRE',
        decision: decision as any,
        decisionMadeAt: new Date(),
        decisionMadeById: userId,
      },
    });

    this.app.wsManager.broadcastToSite(alert.siteId, 'fire-alarm:confirmed', {
      fireAlertId: alert.id,
      decision,
      evacuateZones: options?.evacuateZones,
      avoidZones: options?.avoidZones,
      message: isDirected
        ? `REAL FIRE CONFIRMED — DIRECTED evacuation. Evacuating zones: ${options!.evacuateZones!.join(', ')}. Avoiding: ${options?.avoidZones?.join(', ') || 'none'}.`
        : 'REAL FIRE CONFIRMED — initiating full building evacuation. All doors unlocking.',
    });

    if (isDirected) {
      // Directed evacuation — only unlock doors along safe routes
      const routes = await this.app.prisma.evacuationRoute.findMany({
        where: {
          siteId: alert.siteId,
          fromZones: { hasSome: options!.evacuateZones! },
        },
      });

      const doorIdsToUnlock = new Set<string>();
      for (const route of routes) {
        // Skip routes that pass through avoid zones
        const shouldSkip = options?.avoidZones?.some(z => route.fromZones.includes(z)) || false;
        if (!shouldSkip) {
          for (const doorId of route.doorIds) {
            doorIdsToUnlock.add(doorId);
          }
        }
      }

      if (doorIdsToUnlock.size > 0) {
        await this.app.prisma.door.updateMany({
          where: { id: { in: Array.from(doorIdsToUnlock) } },
          data: { status: 'UNLOCKED' },
        });
      }

      this.app.wsManager.broadcastToSite(alert.siteId, 'door:directed-unlock', {
        reason: 'directed_fire_evacuation',
        fireAlertId: alert.id,
        doorIds: Array.from(doorIdsToUnlock),
        evacuateZones: options!.evacuateZones,
      });
    } else {
      // Full evacuation — unlock all doors
      await this.app.prisma.door.updateMany({
        where: { siteId: alert.siteId },
        data: { status: 'UNLOCKED' },
      });

      this.app.wsManager.broadcastToSite(alert.siteId, 'door:mass-unlock', {
        reason: 'fire_evacuation',
        fireAlertId: alert.id,
      });
    }

    // Enqueue fire response jobs (dispatch fire department, notify all)
    await this.enqueueJobs(alert, false);

    // Audit log
    await this.app.prisma.auditLog.create({
      data: {
        siteId: alert.siteId,
        userId,
        action: 'FIRE_ALARM_CONFIRMED',
        entity: 'Alert',
        entityId: alert.id,
        details: {
          previousStatus: 'SUPPRESSED',
          reason: 'operator_confirmed_real_fire',
          decision,
          evacuateZones: options?.evacuateZones,
          avoidZones: options?.avoidZones,
        },
        ipAddress,
      },
    });

    return alert;
  }

  /**
   * Dismiss a suppressed fire alarm as a false alarm — maintain lockdown.
   * The fire alert is cancelled and lockdown continues undisturbed.
   */
  async dismissFire(alertId: string, userId: string, ipAddress?: string): Promise<Alert> {
    const existing = await this.app.prisma.alert.findUniqueOrThrow({ where: { id: alertId } });

    if (existing.status !== 'SUPPRESSED' || existing.level !== 'FIRE') {
      throw new Error('Alert is not a suppressed fire alarm');
    }

    const alert = await this.app.prisma.alert.update({
      where: { id: alertId },
      data: {
        status: 'CANCELLED',
        message: `[FALSE ALARM] ${(existing.message || '').replace(/\[SUPPRESSED\]|\[INVESTIGATING\]/g, '')}`.trim(),
        metadata: {
          ...(existing.metadata as any || {}),
          suppressed: false,
          awaitingDecision: false,
          dismissedAt: new Date().toISOString(),
          dismissedBy: userId,
          dismissedReason: 'false_alarm_during_lockdown',
        },
      },
    });

    // Update FireAlarmEvent
    await this.app.prisma.fireAlarmEvent.updateMany({
      where: { alertId, status: { in: ['ALARM_ACTIVE', 'ACKNOWLEDGED_ALARM', 'INVESTIGATING'] } },
      data: {
        status: 'FALSE_ALARM',
        decision: 'MAINTAIN_LOCKDOWN' as any,
        decisionMadeAt: new Date(),
        decisionMadeById: userId,
      },
    });

    this.app.wsManager.broadcastToSite(alert.siteId, 'fire-alarm:dismissed', {
      fireAlertId: alert.id,
      message: 'Fire alarm dismissed as false alarm. Lockdown continues.',
    });

    // Notify staff
    await this.app.alertQueue.add('notify-staff', {
      alertId: alert.id,
      siteId: alert.siteId,
      level: 'FIRE',
      message: `Fire alarm in ${existing.buildingName} dismissed as FALSE ALARM. Lockdown remains in effect. Doors remain LOCKED.`,
    });

    // Audit log
    await this.app.prisma.auditLog.create({
      data: {
        siteId: alert.siteId,
        userId,
        action: 'FIRE_ALARM_DISMISSED',
        entity: 'Alert',
        entityId: alert.id,
        details: { previousStatus: 'SUPPRESSED', reason: 'false_alarm_during_lockdown' },
        ipAddress,
      },
    });

    return alert;
  }

  /**
   * Extend investigation beyond the 3-minute PAS window.
   * Only allowed when an active threat is verified on the property (per Indiana model).
   * Requires explicit justification.
   */
  async extendFireInvestigation(
    alertId: string,
    userId: string,
    reason: string,
    ipAddress?: string,
  ): Promise<Alert> {
    const existing = await this.app.prisma.alert.findUniqueOrThrow({ where: { id: alertId } });

    if (existing.status !== 'SUPPRESSED' || existing.level !== 'FIRE') {
      throw new Error('Alert is not a suppressed fire alarm');
    }

    const metadata = (existing.metadata as any) || {};

    const alert = await this.app.prisma.alert.update({
      where: { id: alertId },
      data: {
        message: `[EXTENDED HOLD] Active threat verified — fire investigation extended. Reason: ${reason}`,
        metadata: {
          ...metadata,
          pasProtocol: {
            ...metadata.pasProtocol,
            extended: true,
            extendedAt: new Date().toISOString(),
            extendedBy: userId,
            extensionReason: reason,
          },
        },
      },
    });

    // Update FireAlarmEvent
    await this.app.prisma.fireAlarmEvent.updateMany({
      where: { alertId, status: { in: ['INVESTIGATING', 'AUTO_ESCALATED'] } },
      data: {
        decision: 'EXTEND_INVESTIGATION' as any,
        notes: `Extended by operator: ${reason}`,
      },
    });

    this.app.wsManager.broadcastToSite(alert.siteId, 'fire-alarm:extended', {
      fireAlertId: alert.id,
      extendedBy: userId,
      reason,
      message: `Fire investigation extended — active threat verified. Reason: ${reason}`,
    });

    await this.app.prisma.auditLog.create({
      data: {
        siteId: alert.siteId,
        userId,
        action: 'FIRE_ALARM_INVESTIGATION_EXTENDED',
        entity: 'Alert',
        entityId: alert.id,
        details: { reason, previousDeadline: metadata.pasProtocol?.investigationDeadline },
        ipAddress,
      },
    });

    return alert;
  }

  /**
   * Handle PAS auto-escalation when acknowledgment or investigation times out.
   * Called by BullMQ delayed job.
   */
  async handleFirePasTimeout(alertId: string, reason: string): Promise<void> {
    const existing = await this.app.prisma.alert.findUniqueOrThrow({ where: { id: alertId } });

    // If already decided (confirmed, dismissed, cancelled, resolved), skip
    if (existing.status !== 'SUPPRESSED') return;

    const metadata = (existing.metadata as any) || {};
    const pasProtocol = metadata.pasProtocol || {};

    // If already acknowledged and extended, skip
    if (pasProtocol.extended) return;

    // Auto-escalate: revert to full fire alarm (NFPA 72 PAS requirement)
    this.app.log.warn(
      { alertId, siteId: existing.siteId, reason },
      'PAS timeout — auto-escalating fire alarm to full notification',
    );

    await this.app.prisma.alert.update({
      where: { id: alertId },
      data: {
        status: 'TRIGGERED',
        message: `[AUTO-ESCALATED] PAS timeout: ${reason}. Full fire alarm activated.`,
        metadata: {
          ...metadata,
          suppressed: false,
          awaitingDecision: false,
          autoEscalatedAt: new Date().toISOString(),
          autoEscalationReason: reason,
        },
      },
    });

    // Update FireAlarmEvent
    await this.app.prisma.fireAlarmEvent.updateMany({
      where: { alertId, status: { in: ['ALARM_ACTIVE', 'ACKNOWLEDGED_ALARM', 'INVESTIGATING'] } },
      data: { status: 'AUTO_ESCALATED' },
    });

    // Broadcast auto-escalation
    this.app.wsManager.broadcastToSite(existing.siteId, 'fire-alarm:auto-escalated', {
      fireAlertId: alertId,
      reason,
      message: `PAS TIMEOUT — Fire alarm auto-escalated to full notification. ${reason}`,
    });

    // Now process as a normal fire alert (dispatch, notify, etc.)
    const alert = await this.app.prisma.alert.findUniqueOrThrow({ where: { id: alertId } });
    await this.enqueueJobs(alert, false);

    await this.app.prisma.auditLog.create({
      data: {
        siteId: existing.siteId,
        action: 'FIRE_ALARM_PAS_AUTO_ESCALATED',
        entity: 'Alert',
        entityId: alertId,
        details: { reason },
      },
    });
  }

  private async enqueueJobs(alert: Alert, trainingMode = false): Promise<void> {
    // In training mode, skip 911 dispatch entirely — this is the critical safety gate
    if (!trainingMode) {
      // Always dispatch 911 for threat-level alerts
      const dispatchLevels = ['ACTIVE_THREAT', 'LOCKDOWN', 'FIRE'];
      if (dispatchLevels.includes(alert.level)) {
        // Fetch full site address for NENA i3 civic address
        const site = await this.app.prisma.site.findUnique({ where: { id: alert.siteId } });

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
          // Site civic address for NENA i3 dispatch
          siteAddress: site?.address,
          siteCity: site?.city,
          siteState: site?.state,
          siteZip: site?.zip,
        });
      }
    } else {
      this.app.log.info({ alertId: alert.id }, 'Training mode: skipping 911 dispatch');
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
    const baseMessage = alert.message || `${alert.level} alert in ${alert.buildingName}${alert.roomName ? ` - ${alert.roomName}` : ''}`;
    const notifyMessage = trainingMode && !baseMessage.startsWith('[TRAINING]')
      ? `[TRAINING] ${baseMessage}`
      : baseMessage;
    await this.app.alertQueue.add('notify-staff', {
      alertId: alert.id,
      siteId: alert.siteId,
      level: alert.level,
      message: notifyMessage,
    });

    // In training mode, skip auto-escalation — drills shouldn't cascade
    if (!trainingMode) {
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
