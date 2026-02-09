/**
 * Notification templates for the SafeSchool platform.
 * Used by the notification service to format SMS, email, and push messages.
 */

export interface NotificationTemplate {
  id: string;
  name: string;
  channel: 'sms' | 'email' | 'push' | 'pa';
  subject?: string; // email only
  body: string;
  variables: string[];
}

// Variable interpolation: {{variableName}}
export function renderTemplate(template: NotificationTemplate, vars: Record<string, string>): {
  subject?: string;
  body: string;
} {
  let body = template.body;
  let subject = template.subject;

  for (const [key, value] of Object.entries(vars)) {
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    body = body.replace(pattern, value);
    if (subject) subject = subject.replace(pattern, value);
  }

  return { subject, body };
}

// --- Alert Templates ---

export const ALERT_LOCKDOWN_SMS: NotificationTemplate = {
  id: 'alert-lockdown-sms',
  name: 'Lockdown Alert (SMS)',
  channel: 'sms',
  body: 'LOCKDOWN at {{siteName}}. {{message}} Do not approach the building. Follow staff instructions. This is not a drill.',
  variables: ['siteName', 'message'],
};

export const ALERT_LOCKDOWN_EMAIL: NotificationTemplate = {
  id: 'alert-lockdown-email',
  name: 'Lockdown Alert (Email)',
  channel: 'email',
  subject: 'LOCKDOWN ALERT - {{siteName}}',
  body: `LOCKDOWN ALERT

{{siteName}} is currently under lockdown.

{{message}}

Building: {{buildingName}}
Time: {{timestamp}}

Instructions:
- Do not approach the building
- Follow all staff instructions
- Wait for an all-clear notification
- Contact local emergency services if you see a threat

This message was sent by SafeSchool OS.`,
  variables: ['siteName', 'buildingName', 'message', 'timestamp'],
};

export const ALERT_LOCKDOWN_PUSH: NotificationTemplate = {
  id: 'alert-lockdown-push',
  name: 'Lockdown Alert (Push)',
  channel: 'push',
  body: 'LOCKDOWN at {{siteName}}: {{message}}',
  variables: ['siteName', 'message'],
};

export const ALERT_LOCKDOWN_PA: NotificationTemplate = {
  id: 'alert-lockdown-pa',
  name: 'Lockdown Alert (PA/Intercom)',
  channel: 'pa',
  body: 'Attention. Lockdown. Lockdown. Lockdown. All students and staff, initiate lockdown procedures immediately. This is not a drill. Secure all doors and windows. Stay away from doors and windows. Remain in your current location until an all-clear is given.',
  variables: [],
};

export const ALERT_ALL_CLEAR_SMS: NotificationTemplate = {
  id: 'alert-all-clear-sms',
  name: 'All Clear (SMS)',
  channel: 'sms',
  body: 'ALL CLEAR at {{siteName}}. The lockdown has been lifted. Normal operations may resume. Thank you for your cooperation.',
  variables: ['siteName'],
};

export const ALERT_ALL_CLEAR_EMAIL: NotificationTemplate = {
  id: 'alert-all-clear-email',
  name: 'All Clear (Email)',
  channel: 'email',
  subject: 'ALL CLEAR - {{siteName}} Lockdown Lifted',
  body: `ALL CLEAR

The lockdown at {{siteName}} has been lifted.

Time: {{timestamp}}
Duration: {{duration}}

Normal operations may resume. If you have any concerns, please contact the main office.

This message was sent by SafeSchool OS.`,
  variables: ['siteName', 'timestamp', 'duration'],
};

export const ALERT_MEDICAL_SMS: NotificationTemplate = {
  id: 'alert-medical-sms',
  name: 'Medical Emergency (SMS)',
  channel: 'sms',
  body: 'MEDICAL EMERGENCY at {{siteName}}, {{buildingName}}. {{message}} Emergency services have been contacted.',
  variables: ['siteName', 'buildingName', 'message'],
};

// --- Visitor Templates ---

export const VISITOR_CHECKIN_EMAIL: NotificationTemplate = {
  id: 'visitor-checkin-email',
  name: 'Visitor Check-In Notification (Email)',
  channel: 'email',
  subject: 'Visitor Checked In - {{visitorName}}',
  body: `Visitor Check-In Notification

A visitor has checked in at {{siteName}}.

Visitor: {{visitorName}}
Purpose: {{purpose}}
Destination: {{destination}}
Check-in Time: {{timestamp}}
Screening: {{screeningStatus}}

This message was sent by SafeSchool OS.`,
  variables: ['siteName', 'visitorName', 'purpose', 'destination', 'timestamp', 'screeningStatus'],
};

export const VISITOR_FLAGGED_SMS: NotificationTemplate = {
  id: 'visitor-flagged-sms',
  name: 'Visitor Flagged (SMS)',
  channel: 'sms',
  body: 'VISITOR ALERT at {{siteName}}: {{visitorName}} flagged during screening. Reason: {{reason}}. Immediate review required.',
  variables: ['siteName', 'visitorName', 'reason'],
};

export const VISITOR_FLAGGED_EMAIL: NotificationTemplate = {
  id: 'visitor-flagged-email',
  name: 'Visitor Flagged (Email)',
  channel: 'email',
  subject: 'VISITOR FLAGGED - {{visitorName}} at {{siteName}}',
  body: `VISITOR SCREENING ALERT

A visitor has been flagged during screening at {{siteName}}.

Visitor: {{visitorName}}
Reason: {{reason}}
Time: {{timestamp}}

Immediate review is required. Please check the visitor management console.

This message was sent by SafeSchool OS.`,
  variables: ['siteName', 'visitorName', 'reason', 'timestamp'],
};

// --- Transportation Templates ---

export const BUS_ARRIVAL_SMS: NotificationTemplate = {
  id: 'bus-arrival-sms',
  name: 'Bus Arrival (SMS)',
  channel: 'sms',
  body: 'Bus {{busNumber}} (Route {{routeName}}) has arrived at {{stopName}}. Your child {{studentName}} should board/exit shortly.',
  variables: ['busNumber', 'routeName', 'stopName', 'studentName'],
};

export const BUS_ARRIVAL_PUSH: NotificationTemplate = {
  id: 'bus-arrival-push',
  name: 'Bus Arrival (Push)',
  channel: 'push',
  body: 'Bus {{busNumber}} arrived at {{stopName}}',
  variables: ['busNumber', 'stopName'],
};

export const BUS_DEPARTURE_SMS: NotificationTemplate = {
  id: 'bus-departure-sms',
  name: 'Bus Departure (SMS)',
  channel: 'sms',
  body: 'Bus {{busNumber}} (Route {{routeName}}) has departed from {{stopName}}. {{studentName}} scanned at {{scanTime}}.',
  variables: ['busNumber', 'routeName', 'stopName', 'studentName', 'scanTime'],
};

export const STUDENT_SCAN_SMS: NotificationTemplate = {
  id: 'student-scan-sms',
  name: 'Student RFID Scan (SMS)',
  channel: 'sms',
  body: '{{studentName}} scanned onto Bus {{busNumber}} at {{stopName}} ({{scanTime}}). Route: {{routeName}}.',
  variables: ['studentName', 'busNumber', 'stopName', 'scanTime', 'routeName'],
};

export const STUDENT_SCAN_PUSH: NotificationTemplate = {
  id: 'student-scan-push',
  name: 'Student RFID Scan (Push)',
  channel: 'push',
  body: '{{studentName}} boarded Bus {{busNumber}} at {{scanTime}}',
  variables: ['studentName', 'busNumber', 'scanTime'],
};

export const MISSED_BUS_SMS: NotificationTemplate = {
  id: 'missed-bus-sms',
  name: 'Missed Bus Alert (SMS)',
  channel: 'sms',
  body: 'NOTICE: {{studentName}} was not scanned for Bus {{busNumber}} (Route {{routeName}}) at {{stopName}}. Expected departure: {{expectedTime}}. Please verify.',
  variables: ['studentName', 'busNumber', 'routeName', 'stopName', 'expectedTime'],
};

export const MISSED_BUS_EMAIL: NotificationTemplate = {
  id: 'missed-bus-email',
  name: 'Missed Bus Alert (Email)',
  channel: 'email',
  subject: 'Missed Bus Alert - {{studentName}}',
  body: `Missed Bus Notification

{{studentName}} was not scanned for their assigned bus.

Bus: {{busNumber}} (Route {{routeName}})
Stop: {{stopName}}
Expected Time: {{expectedTime}}

Please verify your child's transportation arrangements. If your child is at school, no action is needed.

Contact the transportation office at {{schoolPhone}} if you have questions.

This message was sent by SafeSchool OS.`,
  variables: ['studentName', 'busNumber', 'routeName', 'stopName', 'expectedTime', 'schoolPhone'],
};

// --- Drill Templates ---

export const DRILL_REMINDER_EMAIL: NotificationTemplate = {
  id: 'drill-reminder-email',
  name: 'Drill Reminder (Email)',
  channel: 'email',
  subject: 'Upcoming Drill - {{drillType}} at {{siteName}}',
  body: `Drill Reminder

A {{drillType}} drill is scheduled at {{siteName}}.

Date/Time: {{scheduledAt}}
Building: {{buildingName}}

Please review the drill procedures and ensure all participants are aware.

Notes: {{notes}}

This message was sent by SafeSchool OS.`,
  variables: ['drillType', 'siteName', 'scheduledAt', 'buildingName', 'notes'],
};

// --- Reunification Templates ---

export const REUNIFICATION_STARTED_SMS: NotificationTemplate = {
  id: 'reunification-started-sms',
  name: 'Reunification Started (SMS)',
  channel: 'sms',
  body: 'REUNIFICATION: Student reunification is underway at {{siteName}}. Location: {{location}}. Please proceed to the reunification point with valid ID. Total students: {{totalStudents}}.',
  variables: ['siteName', 'location', 'totalStudents'],
};

export const REUNIFICATION_STARTED_EMAIL: NotificationTemplate = {
  id: 'reunification-started-email',
  name: 'Reunification Started (Email)',
  channel: 'email',
  subject: 'Student Reunification - {{siteName}}',
  body: `Student Reunification Notice

A student reunification event has been initiated at {{siteName}}.

Location: {{location}}
Total Students: {{totalStudents}}
Started At: {{timestamp}}

Instructions:
1. Proceed to the reunification point at {{location}}
2. Bring valid government-issued photo ID
3. Only authorized guardians may pick up students
4. Be patient - student safety is our priority

This message was sent by SafeSchool OS.`,
  variables: ['siteName', 'location', 'totalStudents', 'timestamp'],
};

// --- All templates grouped by category ---

export const NOTIFICATION_TEMPLATES = {
  alerts: [
    ALERT_LOCKDOWN_SMS,
    ALERT_LOCKDOWN_EMAIL,
    ALERT_LOCKDOWN_PUSH,
    ALERT_LOCKDOWN_PA,
    ALERT_ALL_CLEAR_SMS,
    ALERT_ALL_CLEAR_EMAIL,
    ALERT_MEDICAL_SMS,
  ],
  visitors: [
    VISITOR_CHECKIN_EMAIL,
    VISITOR_FLAGGED_SMS,
    VISITOR_FLAGGED_EMAIL,
  ],
  transportation: [
    BUS_ARRIVAL_SMS,
    BUS_ARRIVAL_PUSH,
    BUS_DEPARTURE_SMS,
    STUDENT_SCAN_SMS,
    STUDENT_SCAN_PUSH,
    MISSED_BUS_SMS,
    MISSED_BUS_EMAIL,
  ],
  drills: [
    DRILL_REMINDER_EMAIL,
  ],
  reunification: [
    REUNIFICATION_STARTED_SMS,
    REUNIFICATION_STARTED_EMAIL,
  ],
};

export function getTemplateById(id: string): NotificationTemplate | undefined {
  for (const category of Object.values(NOTIFICATION_TEMPLATES)) {
    const found = category.find((t) => t.id === id);
    if (found) return found;
  }
  return undefined;
}

export function getTemplatesByChannel(channel: NotificationTemplate['channel']): NotificationTemplate[] {
  const result: NotificationTemplate[] = [];
  for (const category of Object.values(NOTIFICATION_TEMPLATES)) {
    result.push(...category.filter((t) => t.channel === channel));
  }
  return result;
}
