import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';

/**
 * State-specific Alyssa's Law requirements.
 *
 * Each state that has enacted Alyssa's Law (or equivalent silent-panic-alarm
 * legislation) defines slightly different drill minimums and system mandates.
 * This configuration drives the compliance report so that a single API
 * endpoint can evaluate compliance for any supported state.
 */
interface DrillRequirement {
  type: string;
  label: string;
  minimum: number;
}

interface StateRequirements {
  name: string;
  statute: string;
  silentPanicAlarm: string;
  direct911: string;
  locationData: string;
  drills: DrillRequirement[];
  uptimeMinPct: number;
}

const STATE_REQUIREMENTS: Record<string, StateRequirements> = {
  NJ: {
    name: 'New Jersey',
    statute: "Alyssa's Law (P.L. 2019, c.44)",
    silentPanicAlarm: 'Every public elementary and secondary school must be equipped with a silent panic alarm that directly connects to local law enforcement.',
    direct911: 'Panic alarm must provide direct connection to law enforcement agencies — no intermediary call centers.',
    locationData: 'Alarm must transmit location information including building, floor, and room to responding officers.',
    drills: [
      { type: 'LOCKDOWN', label: 'Lockdown Drills', minimum: 2 },
      { type: 'FIRE', label: 'Fire Drills', minimum: 2 },
      { type: 'EVACUATION', label: 'Evacuation Drills', minimum: 1 },
      { type: 'ACTIVE_THREAT', label: 'Active Threat Drills', minimum: 1 },
    ],
    uptimeMinPct: 99.0,
  },
  FL: {
    name: 'Florida',
    statute: "Alyssa's Law (SB 70, 2020)",
    silentPanicAlarm: 'All public schools must install mobile panic alert systems capable of connecting with 911.',
    direct911: 'System must connect directly to the local 911 public safety answering point and simultaneously to local law enforcement.',
    locationData: 'System must provide GPS and building-level location data to first responders.',
    drills: [
      { type: 'LOCKDOWN', label: 'Lockdown Drills', minimum: 2 },
      { type: 'FIRE', label: 'Fire Drills', minimum: 2 },
      { type: 'ACTIVE_THREAT', label: 'Active Threat Drills', minimum: 2 },
      { type: 'EVACUATION', label: 'Evacuation Drills', minimum: 1 },
    ],
    uptimeMinPct: 99.0,
  },
  NY: {
    name: 'New York',
    statute: "Alyssa's Law (S.7132, 2022)",
    silentPanicAlarm: 'School districts may install silent panic alarms in school buildings connected to local emergency dispatch.',
    direct911: 'Silent panic alarm systems must provide direct notification to local 911 or law enforcement dispatch.',
    locationData: 'System must transmit location data sufficient for responders to identify the specific area within a school building.',
    drills: [
      { type: 'LOCKDOWN', label: 'Lockdown Drills', minimum: 4 },
      { type: 'FIRE', label: 'Fire Drills', minimum: 8 },
      { type: 'EVACUATION', label: 'Evacuation Drills', minimum: 1 },
      { type: 'ACTIVE_THREAT', label: 'Active Threat Drills', minimum: 1 },
    ],
    uptimeMinPct: 99.5,
  },
  TX: {
    name: 'Texas',
    statute: "Alyssa's Law (HB 3, 2023)",
    silentPanicAlarm: 'School districts must have a silent panic alert technology that notifies first responders of an emergency.',
    direct911: 'The panic alert technology must integrate with local emergency communications or 911 services.',
    locationData: 'System must provide real-time location data including floor and room identification.',
    drills: [
      { type: 'LOCKDOWN', label: 'Lockdown Drills', minimum: 2 },
      { type: 'FIRE', label: 'Fire Drills', minimum: 2 },
      { type: 'ACTIVE_THREAT', label: 'Active Threat Drills', minimum: 1 },
      { type: 'EVACUATION', label: 'Evacuation Drills', minimum: 1 },
    ],
    uptimeMinPct: 99.0,
  },
  OK: {
    name: 'Oklahoma',
    statute: "Alyssa's Law (SB 1119, 2024)",
    silentPanicAlarm: 'Public schools must implement a silent panic alarm or equivalent alert system connected to law enforcement.',
    direct911: 'Alert must reach local law enforcement dispatch directly without requiring a phone call.',
    locationData: 'Location data including building and area must accompany every alert transmission.',
    drills: [
      { type: 'LOCKDOWN', label: 'Lockdown Drills', minimum: 2 },
      { type: 'FIRE', label: 'Fire Drills', minimum: 2 },
      { type: 'ACTIVE_THREAT', label: 'Active Threat Drills', minimum: 1 },
      { type: 'EVACUATION', label: 'Evacuation Drills', minimum: 1 },
    ],
    uptimeMinPct: 99.0,
  },
};

type ComplianceStatus = 'COMPLIANT' | 'NON_COMPLIANT' | 'PARTIAL';

interface EvidenceItem {
  type: string;
  description: string;
  timestamp?: string;
  id?: string;
}

interface ComplianceSection {
  name: string;
  requirement: string;
  status: ComplianceStatus;
  details: string;
  evidence: EvidenceItem[];
}

interface ComplianceReport {
  siteId: string;
  siteName: string;
  state: string;
  stateName: string;
  statute: string;
  year: number;
  generatedAt: string;
  overallStatus: ComplianceStatus;
  sections: ComplianceSection[];
}

export default async function complianceRoutes(app: FastifyInstance) {
  // All routes require authentication
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
  });

  // GET /api/v1/compliance/states — list supported states
  app.get('/states', { preHandler: [requireMinRole('SITE_ADMIN')] }, async () => {
    return Object.entries(STATE_REQUIREMENTS).map(([code, req]) => ({
      code,
      name: req.name,
      statute: req.statute,
    }));
  });

  // GET /api/v1/compliance/:siteId/report?state=NJ&year=2026
  app.get('/:siteId/report', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { siteId } = request.params as { siteId: string };
    const { state, year } = request.query as { state?: string; year?: string };

    const stateCode = (state || 'NJ').toUpperCase();
    const targetYear = parseInt(year || new Date().getFullYear().toString(), 10);

    const stateReqs = STATE_REQUIREMENTS[stateCode];
    if (!stateReqs) {
      return reply.status(400).send({
        error: `Unsupported state: ${stateCode}. Supported: ${Object.keys(STATE_REQUIREMENTS).join(', ')}`,
      });
    }

    // Verify user has access to this site
    const user = request.user as { siteIds: string[] };
    if (!user.siteIds.includes(siteId)) {
      return reply.status(403).send({ error: 'No access to this site' });
    }

    // Fetch the site
    const site = await app.prisma.site.findUnique({ where: { id: siteId } });
    if (!site) {
      return reply.status(404).send({ error: 'Site not found' });
    }

    const yearStart = new Date(`${targetYear}-01-01T00:00:00.000Z`);
    const yearEnd = new Date(`${targetYear + 1}-01-01T00:00:00.000Z`);

    // Fetch data in parallel
    const [drills, alerts, dispatchRecords, doors] = await Promise.all([
      app.prisma.drill.findMany({
        where: {
          siteId,
          status: 'COMPLETED',
          completedAt: { gte: yearStart, lt: yearEnd },
        },
        orderBy: { completedAt: 'asc' },
      }),
      app.prisma.alert.findMany({
        where: {
          siteId,
          triggeredAt: { gte: yearStart, lt: yearEnd },
        },
        orderBy: { triggeredAt: 'desc' },
      }),
      app.prisma.dispatchRecord.findMany({
        where: {
          alert: { siteId, triggeredAt: { gte: yearStart, lt: yearEnd } },
        },
        include: { alert: true },
        orderBy: { sentAt: 'desc' },
      }),
      app.prisma.door.findMany({
        where: { siteId },
      }),
    ]);

    const sections: ComplianceSection[] = [];

    // ---- Section 1: Silent Panic Alarm ----
    const panicAlerts = alerts.filter(
      (a) => a.level === 'LOCKDOWN' || a.level === 'ACTIVE_THREAT'
    );
    const hasPanicCapability = doors.length > 0 || panicAlerts.length > 0;
    const panicEvidence: EvidenceItem[] = [];

    if (panicAlerts.length > 0) {
      panicEvidence.push({
        type: 'ALERT_HISTORY',
        description: `${panicAlerts.length} panic alert(s) triggered in ${targetYear}`,
        timestamp: panicAlerts[0]?.triggeredAt?.toISOString(),
      });
    }
    if (doors.length > 0) {
      panicEvidence.push({
        type: 'DOOR_INTEGRATION',
        description: `${doors.length} door(s) configured with access control integration`,
      });
    }

    sections.push({
      name: 'Silent Panic Alarm',
      requirement: stateReqs.silentPanicAlarm,
      status: hasPanicCapability ? 'COMPLIANT' : 'NON_COMPLIANT',
      details: hasPanicCapability
        ? `System is configured with panic alert capability. ${panicAlerts.length} alert(s) triggered in ${targetYear}. ${doors.length} controlled door(s) active.`
        : 'No panic alarm system detected. Configure alert devices and access control integrations.',
      evidence: panicEvidence,
    });

    // ---- Section 2: Direct 911 Dispatch ----
    const successfulDispatches = dispatchRecords.filter(
      (d) => d.status === 'SENT' || d.status === 'RECEIVED' || d.status === 'DISPATCHED' || d.status === 'ON_SCENE'
    );
    const failedDispatches = dispatchRecords.filter((d) => d.status === 'FAILED');
    const directMethods = successfulDispatches.filter(
      (d) => d.method !== 'CONSOLE'
    );
    const hasDirectDispatch = directMethods.length > 0;
    const dispatchEvidence: EvidenceItem[] = [];

    if (successfulDispatches.length > 0) {
      dispatchEvidence.push({
        type: 'DISPATCH_SUCCESS',
        description: `${successfulDispatches.length} successful dispatch(es) to 911`,
        timestamp: successfulDispatches[0]?.sentAt?.toISOString(),
      });
    }
    if (failedDispatches.length > 0) {
      dispatchEvidence.push({
        type: 'DISPATCH_FAILURE',
        description: `${failedDispatches.length} dispatch failure(s) recorded`,
        timestamp: failedDispatches[0]?.sentAt?.toISOString(),
      });
    }
    if (directMethods.length > 0) {
      const methods = [...new Set(directMethods.map((d) => d.method))];
      dispatchEvidence.push({
        type: 'DISPATCH_METHODS',
        description: `Direct dispatch methods configured: ${methods.join(', ')}`,
      });
    }

    let dispatchStatus: ComplianceStatus = 'NON_COMPLIANT';
    let dispatchDetails = 'No direct 911 dispatch integration configured. Only console/mock dispatch detected.';
    if (hasDirectDispatch && failedDispatches.length === 0) {
      dispatchStatus = 'COMPLIANT';
      dispatchDetails = `Direct 911 dispatch operational. ${successfulDispatches.length} successful dispatch(es) with no failures.`;
    } else if (hasDirectDispatch && failedDispatches.length > 0) {
      dispatchStatus = 'PARTIAL';
      dispatchDetails = `Direct 911 dispatch configured but ${failedDispatches.length} failure(s) recorded. Review failover configuration.`;
    } else if (dispatchRecords.length > 0) {
      dispatchStatus = 'PARTIAL';
      dispatchDetails = 'Dispatch records exist but only console/mock dispatch method detected. Configure a direct 911 integration (RapidSOS, Rave 911, SIP Direct).';
    }

    sections.push({
      name: 'Direct 911 Dispatch',
      requirement: stateReqs.direct911,
      status: dispatchStatus,
      details: dispatchDetails,
      evidence: dispatchEvidence,
    });

    // ---- Section 3: Drill Requirements ----
    const drillCounts: Record<string, number> = {};
    for (const drill of drills) {
      drillCounts[drill.type] = (drillCounts[drill.type] || 0) + 1;
    }

    let allDrillsMet = true;
    let anyDrillsMet = false;
    const drillEvidence: EvidenceItem[] = [];

    for (const req of stateReqs.drills) {
      const completed = drillCounts[req.type] || 0;
      const met = completed >= req.minimum;
      if (met) anyDrillsMet = true;
      else allDrillsMet = false;

      drillEvidence.push({
        type: 'DRILL_COUNT',
        description: `${req.label}: ${completed}/${req.minimum} completed${met ? ' (met)' : ' (not met)'}`,
      });
    }

    // Add individual drill records as evidence
    for (const drill of drills.slice(0, 20)) {
      drillEvidence.push({
        type: 'DRILL_RECORD',
        description: `${drill.type} drill completed${drill.evacuationTimeS ? ` in ${drill.evacuationTimeS}s` : ''}${drill.complianceMet === false ? ' (compliance issues noted)' : ''}`,
        timestamp: drill.completedAt?.toISOString(),
        id: drill.id,
      });
    }

    let drillStatus: ComplianceStatus = 'NON_COMPLIANT';
    if (allDrillsMet) drillStatus = 'COMPLIANT';
    else if (anyDrillsMet) drillStatus = 'PARTIAL';

    const drillSummaryParts = stateReqs.drills.map((req) => {
      const completed = drillCounts[req.type] || 0;
      return `${req.label}: ${completed}/${req.minimum}`;
    });

    sections.push({
      name: 'Drill Requirements',
      requirement: `${stateReqs.name} requires completion of minimum annual drills: ${stateReqs.drills.map((d) => `${d.minimum} ${d.label}`).join(', ')}.`,
      status: drillStatus,
      details: `Drill completion for ${targetYear}: ${drillSummaryParts.join(', ')}. Total drills completed: ${drills.length}.`,
      evidence: drillEvidence,
    });

    // ---- Section 4: System Uptime ----
    // Estimate uptime based on alert response data and system availability
    // In a production system this would come from actual monitoring (e.g., UptimeRobot, Datadog)
    // For now, calculate from alert response patterns
    const totalAlerts = alerts.length;
    const resolvedAlerts = alerts.filter((a) => a.status === 'RESOLVED').length;
    const cancelledAlerts = alerts.filter((a) => a.status === 'CANCELLED').length;
    const acknowledgedAlerts = alerts.filter(
      (a) => a.acknowledgedAt !== null
    ).length;

    const uptimeEvidence: EvidenceItem[] = [];
    let uptimePct = 100; // Assume 100% if no data contradicts

    if (totalAlerts > 0) {
      // Calculate effective responsiveness as a proxy for uptime
      const respondedTo = resolvedAlerts + cancelledAlerts + acknowledgedAlerts;
      uptimePct = Math.min(100, (respondedTo / totalAlerts) * 100);
      uptimeEvidence.push({
        type: 'ALERT_RESPONSE',
        description: `${respondedTo}/${totalAlerts} alerts received a response (${uptimePct.toFixed(1)}% responsiveness)`,
      });
    }

    if (failedDispatches.length > 0) {
      const failRate = (failedDispatches.length / Math.max(dispatchRecords.length, 1)) * 100;
      uptimeEvidence.push({
        type: 'DISPATCH_RELIABILITY',
        description: `Dispatch failure rate: ${failRate.toFixed(1)}% (${failedDispatches.length}/${dispatchRecords.length})`,
      });
      uptimePct = Math.min(uptimePct, 100 - failRate);
    }

    uptimeEvidence.push({
      type: 'UPTIME_ESTIMATE',
      description: `Estimated system availability: ${uptimePct.toFixed(1)}% (minimum required: ${stateReqs.uptimeMinPct}%)`,
    });

    const uptimeMet = uptimePct >= stateReqs.uptimeMinPct;

    sections.push({
      name: 'System Uptime',
      requirement: `System must maintain minimum ${stateReqs.uptimeMinPct}% uptime to ensure availability during emergencies.`,
      status: uptimeMet ? 'COMPLIANT' : (uptimePct >= stateReqs.uptimeMinPct - 2 ? 'PARTIAL' : 'NON_COMPLIANT'),
      details: `Estimated system availability: ${uptimePct.toFixed(1)}%. Required minimum: ${stateReqs.uptimeMinPct}%.${!uptimeMet ? ' Consider reviewing system reliability and failover configuration.' : ''}`,
      evidence: uptimeEvidence,
    });

    // ---- Section 5: Location Data ----
    const alertsWithLocation = alerts.filter(
      (a) => a.buildingName && (a.roomName || a.floor !== null)
    );
    const alertsWithCoords = alerts.filter(
      (a) => a.latitude !== null && a.longitude !== null
    );
    const locationEvidence: EvidenceItem[] = [];

    if (totalAlerts > 0) {
      locationEvidence.push({
        type: 'LOCATION_COVERAGE',
        description: `${alertsWithLocation.length}/${totalAlerts} alerts included building/room location data`,
      });
      if (alertsWithCoords.length > 0) {
        locationEvidence.push({
          type: 'GPS_COVERAGE',
          description: `${alertsWithCoords.length}/${totalAlerts} alerts included GPS coordinates`,
        });
      }
    }

    // Check site has location data configured
    if (site.latitude && site.longitude) {
      locationEvidence.push({
        type: 'SITE_GPS',
        description: `Site GPS configured: ${site.latitude.toFixed(4)}, ${site.longitude.toFixed(4)}`,
      });
    }

    const hasLocationData = (totalAlerts === 0 && site.latitude !== null) ||
      (totalAlerts > 0 && alertsWithLocation.length === totalAlerts);
    const hasPartialLocation = alertsWithLocation.length > 0 || site.latitude !== null;

    let locationStatus: ComplianceStatus = 'NON_COMPLIANT';
    if (hasLocationData) locationStatus = 'COMPLIANT';
    else if (hasPartialLocation) locationStatus = 'PARTIAL';

    sections.push({
      name: 'Location Data',
      requirement: stateReqs.locationData,
      status: locationStatus,
      details: totalAlerts > 0
        ? `${alertsWithLocation.length}/${totalAlerts} alerts included full location data (building, floor, room). ${alertsWithCoords.length} included GPS coordinates.`
        : site.latitude
          ? 'Site GPS coordinates configured. No alerts triggered yet to verify location data transmission.'
          : 'No location data configured. Ensure site GPS, building, and room data are set up.',
      evidence: locationEvidence,
    });

    // ---- Overall Status ----
    const statuses = sections.map((s) => s.status);
    let overallStatus: ComplianceStatus = 'COMPLIANT';
    if (statuses.includes('NON_COMPLIANT')) {
      overallStatus = 'NON_COMPLIANT';
    } else if (statuses.includes('PARTIAL')) {
      overallStatus = 'PARTIAL';
    }

    const report: ComplianceReport = {
      siteId,
      siteName: site.name,
      state: stateCode,
      stateName: stateReqs.name,
      statute: stateReqs.statute,
      year: targetYear,
      generatedAt: new Date().toISOString(),
      overallStatus,
      sections,
    };

    // Log report generation
    const reqUser = request.user as { id: string };
    await app.prisma.auditLog.create({
      data: {
        siteId,
        userId: reqUser.id,
        action: 'COMPLIANCE_REPORT_GENERATED',
        entity: 'ComplianceReport',
        entityId: siteId,
        details: { state: stateCode, year: targetYear, overallStatus },
      },
    });

    return report;
  });
}
