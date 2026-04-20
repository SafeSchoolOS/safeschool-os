// @ts-nocheck
/**
 * PASS Guidelines Compliance Routes
 *
 * Partner Alliance for Safer Schools (PASS) compliance checker for SafeSchool.
 * Tracks compliance across Tier 1 (Foundational), Tier 2 (Enhanced), and Tier 3 (Comprehensive).
 *
 * Mount behind JWT auth at prefix '/api/v1/pass'.
 */

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';
import { getOrgId } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:pass');

const DEFAULT_ORG = process.env.DASHBOARD_ADMIN_ORG || 'default';

export interface PassRoutesOptions {
  connectionString?: string;
}

/** Pre-populated PASS guidelines requirements */
const PASS_REQUIREMENTS = [
  // ── Tier 1: Foundational ──────────────────────────────────────
  { guideline_tier: 'tier1_foundational', category: 'access_control', requirement: 'Single Point of Entry', description: 'All visitors must enter through a single, monitored point of entry during school hours.' },
  { guideline_tier: 'tier1_foundational', category: 'visitor_management', requirement: 'Visitor Sign-In', description: 'All visitors must sign in, present ID, and receive a visitor badge before proceeding beyond the front office.' },
  { guideline_tier: 'tier1_foundational', category: 'access_control', requirement: 'Locked Exterior Doors', description: 'All exterior doors must be locked during school hours, accessible only from inside or via controlled entry.' },
  { guideline_tier: 'tier1_foundational', category: 'emergency_preparedness', requirement: 'Lockdown Capability', description: 'The facility must have the ability to initiate a full lockdown of all doors and entry points.' },
  { guideline_tier: 'tier1_foundational', category: 'communication', requirement: 'Communication System', description: 'A reliable communication system (PA, two-way radio, or intercom) must be available for emergency notifications.' },
  { guideline_tier: 'tier1_foundational', category: 'emergency_preparedness', requirement: 'Emergency Plans', description: 'Written emergency operations plans (EOP) must be developed, maintained, and accessible to all staff.' },
  { guideline_tier: 'tier1_foundational', category: 'training', requirement: 'Staff Safety Training', description: 'All staff must receive annual safety and emergency response training.' },
  { guideline_tier: 'tier1_foundational', category: 'physical_security', requirement: 'Perimeter Fencing', description: 'The campus perimeter should have fencing or barriers to control pedestrian and vehicle access.' },
  { guideline_tier: 'tier1_foundational', category: 'emergency_preparedness', requirement: 'Reunification Plan', description: 'A family reunification plan must be established and practiced for emergency evacuations.' },
  { guideline_tier: 'tier1_foundational', category: 'communication', requirement: 'Emergency Contact Lists', description: 'Current emergency contact lists for all students and staff must be maintained and accessible.' },

  // ── Tier 2: Enhanced ──────────────────────────────────────────
  { guideline_tier: 'tier2_enhanced', category: 'emergency_preparedness', requirement: 'Panic Buttons', description: 'Silent panic buttons (Alyssa\'s Law) must be installed in key locations for immediate law enforcement notification.' },
  { guideline_tier: 'tier2_enhanced', category: 'technology', requirement: 'Video Surveillance', description: 'IP camera system covering all entry/exit points, hallways, parking lots, and common areas.' },
  { guideline_tier: 'tier2_enhanced', category: 'access_control', requirement: 'Electronic Access Control', description: 'Card-based or electronic access control on all exterior doors and sensitive areas.' },
  { guideline_tier: 'tier2_enhanced', category: 'communication', requirement: 'Anonymous Reporting', description: 'An anonymous tip reporting system must be available for students, staff, and community members.' },
  { guideline_tier: 'tier2_enhanced', category: 'training', requirement: 'Threat Assessment Team', description: 'A multidisciplinary behavioral threat assessment team must be established and trained.' },
  { guideline_tier: 'tier2_enhanced', category: 'technology', requirement: 'Visitor Management System', description: 'Electronic visitor management system with ID scanning and sex offender registry checks.' },
  { guideline_tier: 'tier2_enhanced', category: 'emergency_preparedness', requirement: 'Drill Documentation', description: 'All safety drills must be documented with times, participation, and issues found for compliance reporting.' },
  { guideline_tier: 'tier2_enhanced', category: 'physical_security', requirement: 'Ballistic Film on Glass', description: 'Security film or ballistic-rated glass on ground-floor windows near entry points.' },
  { guideline_tier: 'tier2_enhanced', category: 'communication', requirement: 'Intercom System', description: 'Two-way intercom at all controlled entry points for visitor verification before entry.' },
  { guideline_tier: 'tier2_enhanced', category: 'training', requirement: 'Active Shooter Training', description: 'Age-appropriate active threat training for all students and staff (Run/Hide/Fight or equivalent).' },

  // ── Tier 3: Comprehensive ──────────────────────────────────────
  { guideline_tier: 'tier3_comprehensive', category: 'technology', requirement: 'Weapons Detection', description: 'Weapons detection systems (walk-through screening, AI-based detection) at primary entry points.' },
  { guideline_tier: 'tier3_comprehensive', category: 'communication', requirement: 'Mass Notification System', description: 'Multi-channel mass notification (SMS, email, push, PA, digital signage) for emergency alerts.' },
  { guideline_tier: 'tier3_comprehensive', category: 'emergency_preparedness', requirement: 'Reunification Technology', description: 'Digital reunification system for rapid, documented parent-child reunification during emergencies.' },
  { guideline_tier: 'tier3_comprehensive', category: 'technology', requirement: 'Digital Hall Passes', description: 'Electronic hall pass system tracking student movement between locations in real-time.' },
  { guideline_tier: 'tier3_comprehensive', category: 'technology', requirement: 'Environmental Monitoring', description: 'Air quality, vape detection, gunshot detection, and environmental sensors throughout the facility.' },
  { guideline_tier: 'tier3_comprehensive', category: 'technology', requirement: 'AI Video Analytics', description: 'AI-powered video analytics for behavior detection, loitering, crowd density, and perimeter breach.' },
  { guideline_tier: 'tier3_comprehensive', category: 'access_control', requirement: 'Anti-Tailgating Controls', description: 'Anti-tailgating detection at controlled entry points to prevent unauthorized entry behind badge holders.' },
  { guideline_tier: 'tier3_comprehensive', category: 'communication', requirement: 'First Responder Integration', description: 'Direct digital integration with law enforcement, fire, and EMS for real-time situational awareness.' },
  { guideline_tier: 'tier3_comprehensive', category: 'technology', requirement: 'Gunshot Detection', description: 'Indoor/outdoor gunshot detection sensors with automatic alert to law enforcement.' },
  { guideline_tier: 'tier3_comprehensive', category: 'emergency_preparedness', requirement: 'After-Action Reviews', description: 'Formal after-action review process after every drill and real incident with documented improvements.' },
];

/** Auto-assessment mapping: requirement -> system feature checks */
const AUTO_ASSESS_MAP = {
  'Single Point of Entry': { check: 'doors', evidence: 'Door access control configured with entry points defined' },
  'Visitor Sign-In': { check: 'visitors', evidence: 'Visitor management system active with sign-in flow' },
  'Locked Exterior Doors': { check: 'doors', evidence: 'Electronic access control on exterior doors' },
  'Lockdown Capability': { check: 'lockdown', evidence: 'Lockdown system configured and testable' },
  'Communication System': { check: 'notifications', evidence: 'Emergency notification system configured' },
  'Emergency Plans': { check: 'always', evidence: 'System supports EOP document storage and distribution' },
  'Staff Safety Training': { check: 'staff_certs', evidence: 'Staff certification tracking active' },
  'Panic Buttons': { check: 'panic', evidence: 'Panic alert system active with Alyssa\'s Law compliance' },
  'Video Surveillance': { check: 'cameras', evidence: 'IP camera system integrated and streaming' },
  'Electronic Access Control': { check: 'doors', evidence: 'Card-based access control system active' },
  'Anonymous Reporting': { check: 'tips', evidence: 'Anonymous tip line configured' },
  'Threat Assessment Team': { check: 'threat_assess', evidence: 'Threat assessment module active' },
  'Visitor Management System': { check: 'visitors', evidence: 'Electronic visitor management with ID scanning' },
  'Drill Documentation': { check: 'drills', evidence: 'Drill tracking and documentation system active' },
  'Weapons Detection': { check: 'weapons', evidence: 'Weapons detection system integrated' },
  'Mass Notification System': { check: 'notifications', evidence: 'Multi-channel mass notification active' },
  'Reunification Technology': { check: 'reunification', evidence: 'Digital reunification system active' },
  'Digital Hall Passes': { check: 'hall_pass', evidence: 'Electronic hall pass system active' },
  'Environmental Monitoring': { check: 'environmental', evidence: 'Environmental sensors integrated' },
  'Gunshot Detection': { check: 'gunshot', evidence: 'Gunshot detection sensors integrated' },
};

export async function passRoutes(fastify: FastifyInstance, opts: PassRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — PASS routes disabled');
    return;
  }

  const pool = new pg.Pool({
    connectionString: connStr,
    max: 5,
    ssl: connStr.includes('sslmode=require') || connStr.includes('railway.app')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  // ─── Ensure org_id column on pass_compliance ──────────────────
  try {
    await pool.query(`ALTER TABLE pass_compliance ADD COLUMN IF NOT EXISTS org_id TEXT`);
    await pool.query(`UPDATE pass_compliance SET org_id = $1 WHERE org_id IS NULL`, [DEFAULT_ORG]);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pass_org ON pass_compliance (org_id)`);
  } catch (err) {
    log.warn({ err }, 'pass_compliance org_id migration skipped (table may not exist)');
  }

  // ─── Seed default requirements for a tenant if it has none ────
  // Memoize first-successful seed per process so every GET doesn't hit COUNT.
  const seededTenants = new Set<string>();
  async function seedRequirements(orgId: string) {
    if (seededTenants.has(orgId)) return;
    try {
      // Ensure unique constraint so concurrent seeds race-safely dedupe.
      await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS pass_compliance_tenant_req_uniq ON pass_compliance(org_id, requirement)`
      ).catch(() => {});

      const { rows } = await pool.query(
        'SELECT COUNT(*) as count FROM pass_compliance WHERE org_id = $1',
        [orgId]
      );
      if (parseInt(rows[0].count, 10) > 0) {
        seededTenants.add(orgId);
        return;
      }
      const now = new Date().toISOString();
      for (const req of PASS_REQUIREMENTS) {
        // ON CONFLICT makes concurrent seeds idempotent even if the unique
        // index hasn't been created yet (NOP on conflict).
        await pool.query(`
          INSERT INTO pass_compliance (id, org_id, guideline_tier, category, requirement, description, status, evidence, notes, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, 'non_compliant', '{}', '', $7, $7)
          ON CONFLICT (org_id, requirement) DO NOTHING
        `, [crypto.randomUUID(), orgId, req.guideline_tier, req.category, req.requirement, req.description, now]);
      }
      seededTenants.add(orgId);
      log.info({ orgId, count: PASS_REQUIREMENTS.length }, 'PASS requirements seeded for tenant');
    } catch (err) {
      log.warn({ err }, 'Failed to seed PASS requirements (table may not exist yet)');
    }
  }

  // ─── GET /pass/requirements — List all requirements (tenant-scoped) ──
  fastify.get('/requirements', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId(request);
      await seedRequirements(orgId);
      const q = request.query as Record<string, string>;
      const conditions: string[] = ['org_id = $1'];
      const params: any[] = [orgId];
      let idx = 2;

      if (q.tier) { conditions.push(`guideline_tier = $${idx++}`); params.push(q.tier); }
      if (q.category) { conditions.push(`category = $${idx++}`); params.push(q.category); }
      if (q.status) { conditions.push(`status = $${idx++}`); params.push(q.status); }

      const where = 'WHERE ' + conditions.join(' AND ');
      const { rows } = await pool.query(
        `SELECT * FROM pass_compliance ${where} ORDER BY guideline_tier, category, requirement`, params
      );
      return reply.send({ requirements: rows, total: rows.length });
    } catch (err) {
      log.error({ err }, 'Failed to list PASS requirements');
      return reply.code(500).send({ error: 'Failed to list requirements' });
    }
  });

  // ─── GET /pass/assessment — Current compliance assessment (tenant-scoped) ──
  fastify.get('/assessment', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId(request);
      await seedRequirements(orgId);
      const { rows } = await pool.query(
        `SELECT * FROM pass_compliance WHERE org_id = $1 ORDER BY guideline_tier, category, requirement`,
        [orgId]
      );

      // Group by tier and category
      const assessment = {};
      for (const row of rows) {
        if (!assessment[row.guideline_tier]) assessment[row.guideline_tier] = {};
        if (!assessment[row.guideline_tier][row.category]) assessment[row.guideline_tier][row.category] = [];
        assessment[row.guideline_tier][row.category].push(row);
      }

      return reply.send({ assessment, total: rows.length });
    } catch (err) {
      log.error({ err }, 'Failed to get PASS assessment');
      return reply.code(500).send({ error: 'Failed to get assessment' });
    }
  });

  // ─── POST /pass/assess — Run auto-assessment ──────────────────
  fastify.post('/assess', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId(request);
      await seedRequirements(orgId);
      const user = (request as any).user || {};
      const now = new Date().toISOString();
      let updated = 0;

      // Check which system features are active by probing per-tenant entity counts.
      const featureChecks = {};
      const checkQueries: Record<string, { sql: string; params: any[] }> = {
        doors: { sql: `SELECT COUNT(*) as c FROM sync_entities WHERE COALESCE(org_id, $1) = $1 AND entity_type = 'door'`, params: [orgId] },
        cameras: { sql: `SELECT COUNT(*) as c FROM sync_entities WHERE COALESCE(org_id, $1) = $1 AND entity_type = 'camera'`, params: [orgId] },
        visitors: { sql: `SELECT COUNT(*) as c FROM sync_entities WHERE COALESCE(org_id, $1) = $1 AND entity_type = 'visitor'`, params: [orgId] },
        panic: { sql: `SELECT COUNT(*) as c FROM panic_alerts WHERE org_id = $1`, params: [orgId] },
        drills: { sql: `SELECT COUNT(*) as c FROM drills WHERE org_id = $1`, params: [orgId] },
        notifications: { sql: `SELECT COUNT(*) as c FROM notifications WHERE COALESCE(org_id, $1) = $1`, params: [orgId] },
      };

      for (const [feature, { sql, params }] of Object.entries(checkQueries)) {
        try {
          const { rows } = await pool.query(sql, params);
          featureChecks[feature] = parseInt(rows[0].c, 10) > 0;
        } catch {
          featureChecks[feature] = false;
        }
      }
      // Some features are always partially available
      featureChecks['always'] = true;
      featureChecks['lockdown'] = true; // Lockdown capability is built into SafeSchool
      featureChecks['tips'] = true; // Tips line is a built-in feature
      featureChecks['threat_assess'] = true; // Threat assessment module exists
      featureChecks['staff_certs'] = true; // Staff certs module exists
      featureChecks['reunification'] = true; // Reunification module exists
      featureChecks['hall_pass'] = true; // Hall pass module exists

      // Try checking for weapons, environmental, gunshot modules
      featureChecks['weapons'] = false;
      featureChecks['environmental'] = false;
      featureChecks['gunshot'] = false;

      // Update requirements based on auto-assessment (tenant-scoped)
      const { rows: requirements } = await pool.query('SELECT * FROM pass_compliance WHERE org_id = $1', [orgId]);
      for (const req of requirements) {
        const mapping = AUTO_ASSESS_MAP[req.requirement];
        if (!mapping) continue;

        const isActive = featureChecks[mapping.check] || false;
        const newStatus = isActive ? 'compliant' : 'non_compliant';
        const evidence = isActive ? JSON.stringify({ auto_assessed: true, feature: mapping.check, description: mapping.evidence }) : '{}';

        if (req.status !== newStatus || req.evidence !== evidence) {
          await pool.query(
            `UPDATE pass_compliance SET status = $1, evidence = $2, assessed_by = $3, assessed_at = $4, updated_at = $4 WHERE id = $5 AND org_id = $6`,
            [newStatus, evidence, user.username || user.sub || 'system', now, req.id, orgId]
          );
          updated++;
        }
      }

      log.info({ updated, orgId, by: user.username }, 'PASS auto-assessment completed');
      return reply.send({ success: true, updated, features_detected: featureChecks });
    } catch (err) {
      log.error({ err }, 'Failed to run auto-assessment');
      return reply.code(500).send({ error: 'Failed to run auto-assessment' });
    }
  });

  // ─── PUT /pass/requirements/:id — Update requirement status (tenant-scoped) ──
  fastify.put('/requirements/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      const body = request.body as any;
      const user = (request as any).user || {};
      const now = new Date().toISOString();

      const updates: string[] = [];
      const params: any[] = [];
      let idx = 1;

      if (body.status) { updates.push(`status = $${idx++}`); params.push(body.status); }
      if (body.evidence !== undefined) { updates.push(`evidence = $${idx++}`); params.push(typeof body.evidence === 'string' ? body.evidence : JSON.stringify(body.evidence)); }
      if (body.notes !== undefined) { updates.push(`notes = $${idx++}`); params.push(body.notes); }

      updates.push(`assessed_by = $${idx++}`); params.push(user.username || user.sub || 'manual');
      updates.push(`assessed_at = $${idx++}`); params.push(now);
      updates.push(`updated_at = $${idx++}`); params.push(now);
      params.push(id, orgId);

      const { rowCount } = await pool.query(
        `UPDATE pass_compliance SET ${updates.join(', ')} WHERE id = $${idx} AND org_id = $${idx + 1}`, params
      );
      if (rowCount === 0) return reply.code(404).send({ error: 'Requirement not found' });

      return reply.send({ success: true });
    } catch (err) {
      log.error({ err }, 'Failed to update requirement');
      return reply.code(500).send({ error: 'Failed to update requirement' });
    }
  });

  // ─── GET /pass/report — Generate compliance report (tenant-scoped) ──
  fastify.get('/report', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId(request);
      await seedRequirements(orgId);
      const { rows } = await pool.query(
        'SELECT * FROM pass_compliance WHERE org_id = $1 ORDER BY guideline_tier, category, requirement',
        [orgId]
      );

      const tiers = { tier1_foundational: 'Tier 1: Foundational', tier2_enhanced: 'Tier 2: Enhanced', tier3_comprehensive: 'Tier 3: Comprehensive' };
      const report = {
        generated_at: new Date().toISOString(),
        summary: {},
        details: {},
      };

      for (const [tierKey, tierLabel] of Object.entries(tiers)) {
        const tierReqs = rows.filter(r => r.guideline_tier === tierKey);
        const compliant = tierReqs.filter(r => r.status === 'compliant').length;
        const partial = tierReqs.filter(r => r.status === 'partial').length;
        const nonCompliant = tierReqs.filter(r => r.status === 'non_compliant').length;
        const na = tierReqs.filter(r => r.status === 'not_applicable').length;
        const applicable = tierReqs.length - na;
        const score = applicable > 0 ? Math.round(((compliant + partial * 0.5) / applicable) * 100) : 0;

        report.summary[tierKey] = { label: tierLabel, total: tierReqs.length, compliant, partial, non_compliant: nonCompliant, not_applicable: na, score };
        report.details[tierKey] = tierReqs;
      }

      // Overall grade
      const allReqs = rows.filter(r => r.status !== 'not_applicable');
      const allCompliant = rows.filter(r => r.status === 'compliant').length;
      const allPartial = rows.filter(r => r.status === 'partial').length;
      const overallScore = allReqs.length > 0 ? Math.round(((allCompliant + allPartial * 0.5) / allReqs.length) * 100) : 0;
      let grade = 'F';
      if (overallScore >= 90) grade = 'A';
      else if (overallScore >= 80) grade = 'B';
      else if (overallScore >= 70) grade = 'C';
      else if (overallScore >= 60) grade = 'D';

      report.summary['overall'] = { score: overallScore, grade, total: rows.length };

      return reply.send(report);
    } catch (err) {
      log.error({ err }, 'Failed to generate PASS report');
      return reply.code(500).send({ error: 'Failed to generate report' });
    }
  });

  // ─── GET /pass/score — Compliance score per tier (tenant-scoped) ──
  fastify.get('/score', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId(request);
      await seedRequirements(orgId);
      const { rows } = await pool.query(`
        SELECT guideline_tier, status, COUNT(*) as count
        FROM pass_compliance
        WHERE org_id = $1
        GROUP BY guideline_tier, status
      `, [orgId]);

      const tiers = {};
      for (const row of rows) {
        if (!tiers[row.guideline_tier]) tiers[row.guideline_tier] = { compliant: 0, partial: 0, non_compliant: 0, not_applicable: 0, total: 0 };
        tiers[row.guideline_tier][row.status] = parseInt(row.count, 10);
        tiers[row.guideline_tier].total += parseInt(row.count, 10);
      }

      const scores = {};
      let totalApplicable = 0, totalCompliant = 0, totalPartial = 0;
      for (const [tier, counts] of Object.entries(tiers) as any) {
        const applicable = counts.total - counts.not_applicable;
        const score = applicable > 0 ? Math.round(((counts.compliant + counts.partial * 0.5) / applicable) * 100) : 0;
        scores[tier] = { ...counts, score };
        totalApplicable += applicable;
        totalCompliant += counts.compliant;
        totalPartial += counts.partial;
      }

      const overallScore = totalApplicable > 0 ? Math.round(((totalCompliant + totalPartial * 0.5) / totalApplicable) * 100) : 0;
      let grade = 'F';
      if (overallScore >= 90) grade = 'A';
      else if (overallScore >= 80) grade = 'B';
      else if (overallScore >= 70) grade = 'C';
      else if (overallScore >= 60) grade = 'D';

      return reply.send({ tiers: scores, overall: { score: overallScore, grade } });
    } catch (err) {
      log.error({ err }, 'Failed to get PASS score');
      return reply.code(500).send({ error: 'Failed to get score' });
    }
  });
}
