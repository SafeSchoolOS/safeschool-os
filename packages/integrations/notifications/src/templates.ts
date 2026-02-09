// Notification templates for SafeSchool platform
// Each template returns { subject, body, smsBody } for multi-channel dispatch

// ---------------------------------------------------------------------------
// Template data interfaces
// ---------------------------------------------------------------------------

export interface ActiveThreatData {
  siteName: string;
  buildingName: string;
}

export interface LockdownData {
  siteName: string;
  buildingName: string;
}

export interface FireData {
  siteName: string;
  buildingName: string;
}

export interface MedicalData {
  siteName: string;
  buildingName: string;
  roomName: string;
}

export interface AllClearData {
  siteName: string;
}

export interface VisitorCheckedInData {
  visitorName: string;
  siteName: string;
  purpose: string;
  hostName: string;
}

export interface VisitorFlaggedData {
  visitorName: string;
  siteName: string;
  screeningResult: string;
}

export interface BusArrivalData {
  busNumber: string;
  stopName: string;
  eta: string;
}

export interface BusDepartureData {
  studentName: string;
  busNumber: string;
  time: string;
}

export interface BusDropOffData {
  studentName: string;
  busNumber: string;
  stopName: string;
  time: string;
}

export interface MissedBusData {
  studentName: string;
  busNumber: string;
  routeName: string;
}

export interface DrillScheduledData {
  drillType: string;
  date: string;
  siteName: string;
}

export interface DrillStartingData {
  drillType: string;
  siteName: string;
}

export interface DrillCompletedData {
  drillType: string;
  duration: string;
  compliant: string;
}

// ---------------------------------------------------------------------------
// Template result
// ---------------------------------------------------------------------------

export interface TemplateResult {
  subject: string;
  body: string;
  smsBody: string;
}

// ---------------------------------------------------------------------------
// Emergency Alert templates (SMS, email, push)
// ---------------------------------------------------------------------------

export function activeThreatTemplate(data: ActiveThreatData): TemplateResult {
  const smsBody = `ACTIVE THREAT at ${data.siteName}. ${data.buildingName}. Follow lockdown procedures immediately.`;
  return {
    subject: `ACTIVE THREAT - ${data.siteName}`,
    body: smsBody,
    smsBody,
  };
}

export function lockdownTemplate(data: LockdownData): TemplateResult {
  const smsBody = `LOCKDOWN initiated at ${data.siteName}. ${data.buildingName}. Secure in place. Do not open doors.`;
  return {
    subject: `LOCKDOWN - ${data.siteName}`,
    body: smsBody,
    smsBody,
  };
}

export function fireTemplate(data: FireData): TemplateResult {
  const smsBody = `FIRE ALARM at ${data.siteName}. ${data.buildingName}. Evacuate immediately via nearest exit.`;
  return {
    subject: `FIRE ALARM - ${data.siteName}`,
    body: smsBody,
    smsBody,
  };
}

export function medicalTemplate(data: MedicalData): TemplateResult {
  const smsBody = `Medical emergency at ${data.siteName}. ${data.buildingName} ${data.roomName}. First responders notified.`;
  return {
    subject: `MEDICAL EMERGENCY - ${data.siteName}`,
    body: smsBody,
    smsBody,
  };
}

export function allClearTemplate(data: AllClearData): TemplateResult {
  const smsBody = `ALL CLEAR at ${data.siteName}. Resume normal operations.`;
  return {
    subject: `ALL CLEAR - ${data.siteName}`,
    body: smsBody,
    smsBody,
  };
}

// ---------------------------------------------------------------------------
// Visitor Notification templates (email)
// ---------------------------------------------------------------------------

export function visitorCheckedInTemplate(data: VisitorCheckedInData): TemplateResult {
  const body = `Visitor ${data.visitorName} has checked in at ${data.siteName}. Purpose: ${data.purpose}. Host: ${data.hostName}.`;
  return {
    subject: `Visitor Check-In: ${data.visitorName} at ${data.siteName}`,
    body,
    smsBody: body,
  };
}

export function visitorFlaggedTemplate(data: VisitorFlaggedData): TemplateResult {
  const body = `WARNING: Visitor ${data.visitorName} has been FLAGGED during screening at ${data.siteName}. Screening result: ${data.screeningResult}.`;
  return {
    subject: `VISITOR FLAGGED: ${data.visitorName} at ${data.siteName}`,
    body,
    smsBody: body,
  };
}

// ---------------------------------------------------------------------------
// Bus / Transport Notification templates (SMS, push)
// ---------------------------------------------------------------------------

export function busArrivalTemplate(data: BusArrivalData): TemplateResult {
  const smsBody = `Bus #${data.busNumber} arriving at ${data.stopName} in approximately ${data.eta} minutes.`;
  return {
    subject: `Bus #${data.busNumber} Arriving Soon`,
    body: smsBody,
    smsBody,
  };
}

export function busDepartureTemplate(data: BusDepartureData): TemplateResult {
  const smsBody = `Your child ${data.studentName} boarded Bus #${data.busNumber} at ${data.time}.`;
  return {
    subject: `${data.studentName} Boarded Bus #${data.busNumber}`,
    body: smsBody,
    smsBody,
  };
}

export function busDropOffTemplate(data: BusDropOffData): TemplateResult {
  const smsBody = `Your child ${data.studentName} exited Bus #${data.busNumber} at ${data.stopName} at ${data.time}.`;
  return {
    subject: `${data.studentName} Dropped Off - Bus #${data.busNumber}`,
    body: smsBody,
    smsBody,
  };
}

export function missedBusTemplate(data: MissedBusData): TemplateResult {
  const smsBody = `Alert: ${data.studentName} was not scanned boarding Bus #${data.busNumber} for route ${data.routeName}.`;
  return {
    subject: `Missed Bus Alert: ${data.studentName}`,
    body: smsBody,
    smsBody,
  };
}

// ---------------------------------------------------------------------------
// Drill Reminder templates (email)
// ---------------------------------------------------------------------------

export function drillScheduledTemplate(data: DrillScheduledData): TemplateResult {
  const body = `${data.drillType} drill scheduled for ${data.date} at ${data.siteName}.`;
  return {
    subject: `Drill Scheduled: ${data.drillType} at ${data.siteName}`,
    body,
    smsBody: body,
  };
}

export function drillStartingTemplate(data: DrillStartingData): TemplateResult {
  const body = `${data.drillType} drill starting NOW at ${data.siteName}. This is a DRILL.`;
  return {
    subject: `DRILL STARTING NOW: ${data.drillType} at ${data.siteName}`,
    body,
    smsBody: body,
  };
}

export function drillCompletedTemplate(data: DrillCompletedData): TemplateResult {
  const body = `${data.drillType} drill completed. Duration: ${data.duration}. Compliance: ${data.compliant}.`;
  return {
    subject: `Drill Completed: ${data.drillType}`,
    body,
    smsBody: body,
  };
}

// ---------------------------------------------------------------------------
// Notification type enum for getTemplate lookup
// ---------------------------------------------------------------------------

export type NotificationType =
  // Emergency
  | 'ACTIVE_THREAT'
  | 'LOCKDOWN'
  | 'FIRE'
  | 'MEDICAL'
  | 'ALL_CLEAR'
  // Visitor
  | 'VISITOR_CHECKED_IN'
  | 'VISITOR_FLAGGED'
  // Transport
  | 'BUS_ARRIVAL'
  | 'BUS_DEPARTURE'
  | 'BUS_DROP_OFF'
  | 'MISSED_BUS'
  // Drill
  | 'DRILL_SCHEDULED'
  | 'DRILL_STARTING'
  | 'DRILL_COMPLETED';

// ---------------------------------------------------------------------------
// Template lookup map (string-keyed for dynamic dispatch)
// ---------------------------------------------------------------------------

const templateMap: Record<string, (data: Record<string, string>) => TemplateResult> = {
  ACTIVE_THREAT: (d) => activeThreatTemplate(d as unknown as ActiveThreatData),
  LOCKDOWN: (d) => lockdownTemplate(d as unknown as LockdownData),
  FIRE: (d) => fireTemplate(d as unknown as FireData),
  MEDICAL: (d) => medicalTemplate(d as unknown as MedicalData),
  ALL_CLEAR: (d) => allClearTemplate(d as unknown as AllClearData),
  VISITOR_CHECKED_IN: (d) => visitorCheckedInTemplate(d as unknown as VisitorCheckedInData),
  VISITOR_FLAGGED: (d) => visitorFlaggedTemplate(d as unknown as VisitorFlaggedData),
  BUS_ARRIVAL: (d) => busArrivalTemplate(d as unknown as BusArrivalData),
  BUS_DEPARTURE: (d) => busDepartureTemplate(d as unknown as BusDepartureData),
  BUS_DROP_OFF: (d) => busDropOffTemplate(d as unknown as BusDropOffData),
  MISSED_BUS: (d) => missedBusTemplate(d as unknown as MissedBusData),
  DRILL_SCHEDULED: (d) => drillScheduledTemplate(d as unknown as DrillScheduledData),
  DRILL_STARTING: (d) => drillStartingTemplate(d as unknown as DrillStartingData),
  DRILL_COMPLETED: (d) => drillCompletedTemplate(d as unknown as DrillCompletedData),
};

/**
 * Dynamic template lookup.
 *
 * @param type - One of the NotificationType values (e.g. "ACTIVE_THREAT", "BUS_ARRIVAL")
 * @param data - Key/value pairs supplying the template variables
 * @returns { subject, body, smsBody }
 * @throws Error if the notification type is unknown
 */
export function getTemplate(type: string, data: Record<string, string>): TemplateResult {
  const fn = templateMap[type];
  if (!fn) {
    throw new Error(`Unknown notification template type: ${type}`);
  }
  return fn(data);
}
