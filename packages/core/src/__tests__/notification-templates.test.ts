/**
 * Notification Templates Tests
 *
 * Tests renderTemplate(), getTemplateById(), getTemplatesByChannel(),
 * and validates all template definitions have correct structure.
 */

import { describe, it, expect } from 'vitest';
import {
  renderTemplate,
  getTemplateById,
  getTemplatesByChannel,
  NOTIFICATION_TEMPLATES,
  ALERT_LOCKDOWN_SMS,
  ALERT_LOCKDOWN_EMAIL,
  ALERT_ALL_CLEAR_SMS,
  ALERT_MEDICAL_SMS,
  WEATHER_ALERT_SMS,
  VISITOR_FLAGGED_SMS,
  BUS_ARRIVAL_SMS,
  STUDENT_SCAN_SMS,
  MISSED_BUS_SMS,
  DRILL_REMINDER_EMAIL,
  REUNIFICATION_STARTED_SMS,
  type NotificationTemplate,
} from '../notification-templates.js';

// ---------------------------------------------------------------------------
// renderTemplate
// ---------------------------------------------------------------------------

describe('renderTemplate', () => {
  it('interpolates all variables in body', () => {
    const result = renderTemplate(ALERT_LOCKDOWN_SMS, {
      siteName: 'Lincoln Elementary',
      message: 'Active lockdown initiated',
    });

    expect(result.body).toContain('Lincoln Elementary');
    expect(result.body).toContain('Active lockdown initiated');
    expect(result.body).not.toContain('{{siteName}}');
    expect(result.body).not.toContain('{{message}}');
  });

  it('interpolates variables in email subject', () => {
    const result = renderTemplate(ALERT_LOCKDOWN_EMAIL, {
      siteName: 'Lincoln Elementary',
      buildingName: 'Main Building',
      message: 'Lockdown in progress',
      timestamp: '2026-02-17T12:00:00Z',
    });

    expect(result.subject).toContain('Lincoln Elementary');
    expect(result.subject).not.toContain('{{siteName}}');
    expect(result.body).toContain('Main Building');
  });

  it('leaves unmatched variables as-is', () => {
    const result = renderTemplate(ALERT_LOCKDOWN_SMS, {
      siteName: 'Lincoln Elementary',
      // message not provided
    });

    expect(result.body).toContain('Lincoln Elementary');
    expect(result.body).toContain('{{message}}');
  });

  it('handles templates with no variables', () => {
    const template: NotificationTemplate = {
      id: 'test',
      name: 'Test',
      channel: 'sms',
      body: 'Static message with no variables',
      variables: [],
    };

    const result = renderTemplate(template, {});
    expect(result.body).toBe('Static message with no variables');
  });

  it('replaces multiple occurrences of the same variable', () => {
    const template: NotificationTemplate = {
      id: 'test',
      name: 'Test',
      channel: 'sms',
      body: '{{name}} did something. Regards, {{name}}.',
      variables: ['name'],
    };

    const result = renderTemplate(template, { name: 'Alice' });
    expect(result.body).toBe('Alice did something. Regards, Alice.');
  });

  it('handles special regex characters in variable values safely', () => {
    const result = renderTemplate(ALERT_LOCKDOWN_SMS, {
      siteName: 'Lincoln (Main) Elementary $100',
      message: 'Test with $pecial chars & <tags>',
    });

    expect(result.body).toContain('Lincoln (Main) Elementary $100');
    expect(result.body).toContain('Test with $pecial chars & <tags>');
  });
});

// ---------------------------------------------------------------------------
// getTemplateById
// ---------------------------------------------------------------------------

describe('getTemplateById', () => {
  it('finds alert template by ID', () => {
    const template = getTemplateById('alert-lockdown-sms');
    expect(template).toBeDefined();
    expect(template!.id).toBe('alert-lockdown-sms');
    expect(template!.channel).toBe('sms');
  });

  it('finds weather template by ID', () => {
    const template = getTemplateById('weather-alert-sms');
    expect(template).toBeDefined();
    expect(template!.channel).toBe('sms');
  });

  it('finds visitor template by ID', () => {
    const template = getTemplateById('visitor-flagged-sms');
    expect(template).toBeDefined();
  });

  it('finds transportation template by ID', () => {
    const template = getTemplateById('bus-arrival-sms');
    expect(template).toBeDefined();
  });

  it('finds drill template by ID', () => {
    const template = getTemplateById('drill-reminder-email');
    expect(template).toBeDefined();
  });

  it('finds reunification template by ID', () => {
    const template = getTemplateById('reunification-started-sms');
    expect(template).toBeDefined();
  });

  it('returns undefined for non-existent ID', () => {
    expect(getTemplateById('nonexistent-id')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getTemplatesByChannel
// ---------------------------------------------------------------------------

describe('getTemplatesByChannel', () => {
  it('returns SMS templates', () => {
    const templates = getTemplatesByChannel('sms');
    expect(templates.length).toBeGreaterThan(0);
    for (const t of templates) {
      expect(t.channel).toBe('sms');
    }
  });

  it('returns email templates with subjects', () => {
    const templates = getTemplatesByChannel('email');
    expect(templates.length).toBeGreaterThan(0);
    for (const t of templates) {
      expect(t.channel).toBe('email');
      expect(t.subject).toBeDefined();
    }
  });

  it('returns push templates', () => {
    const templates = getTemplatesByChannel('push');
    expect(templates.length).toBeGreaterThan(0);
    for (const t of templates) {
      expect(t.channel).toBe('push');
    }
  });

  it('returns PA templates', () => {
    const templates = getTemplatesByChannel('pa');
    expect(templates.length).toBeGreaterThan(0);
    for (const t of templates) {
      expect(t.channel).toBe('pa');
    }
  });
});

// ---------------------------------------------------------------------------
// Template structure validation
// ---------------------------------------------------------------------------

describe('All template definitions', () => {
  const allTemplates: NotificationTemplate[] = [];
  for (const category of Object.values(NOTIFICATION_TEMPLATES)) {
    allTemplates.push(...category);
  }

  it('total templates count is at least 20', () => {
    expect(allTemplates.length).toBeGreaterThanOrEqual(20);
  });

  it('all templates have unique IDs', () => {
    const ids = allTemplates.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('all templates have non-empty body', () => {
    for (const t of allTemplates) {
      expect(t.body.length).toBeGreaterThan(0);
    }
  });

  it('all template variables are used in body or subject', () => {
    for (const t of allTemplates) {
      for (const v of t.variables) {
        const inBody = t.body.includes(`{{${v}}}`);
        const inSubject = t.subject?.includes(`{{${v}}}`) ?? false;
        expect(inBody || inSubject).toBe(true);
      }
    }
  });

  it('all template IDs follow kebab-case pattern', () => {
    for (const t of allTemplates) {
      expect(t.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('categories cover alerts, weather, visitors, transportation, drills, reunification', () => {
    expect(NOTIFICATION_TEMPLATES.alerts.length).toBeGreaterThan(0);
    expect(NOTIFICATION_TEMPLATES.weather.length).toBeGreaterThan(0);
    expect(NOTIFICATION_TEMPLATES.visitors.length).toBeGreaterThan(0);
    expect(NOTIFICATION_TEMPLATES.transportation.length).toBeGreaterThan(0);
    expect(NOTIFICATION_TEMPLATES.drills.length).toBeGreaterThan(0);
    expect(NOTIFICATION_TEMPLATES.reunification.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Specific template content tests
// ---------------------------------------------------------------------------

describe('Specific template content', () => {
  it('ALERT_LOCKDOWN_SMS mentions "not a drill"', () => {
    expect(ALERT_LOCKDOWN_SMS.body).toContain('not a drill');
  });

  it('ALERT_ALL_CLEAR_SMS mentions "ALL CLEAR"', () => {
    expect(ALERT_ALL_CLEAR_SMS.body).toContain('ALL CLEAR');
  });

  it('ALERT_MEDICAL_SMS mentions "emergency services"', () => {
    expect(ALERT_MEDICAL_SMS.body).toContain('Emergency services');
  });

  it('MISSED_BUS_SMS includes student name variable', () => {
    expect(MISSED_BUS_SMS.variables).toContain('studentName');
    expect(MISSED_BUS_SMS.body).toContain('{{studentName}}');
  });

  it('REUNIFICATION_STARTED_SMS includes location variable', () => {
    expect(REUNIFICATION_STARTED_SMS.variables).toContain('location');
    expect(REUNIFICATION_STARTED_SMS.body).toContain('{{location}}');
  });
});
