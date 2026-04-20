// @ts-nocheck
/**
 * Natural Language Log Query Routes
 *
 * Let security managers type plain English queries and get results.
 * Uses template-based NLP pattern matching (no external AI API needed).
 *
 * Routes:
 *   POST /query/natural      — Parse natural language query and return results
 *   GET  /query/suggestions   — Return example queries users can try
 */

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';
import { getOrgId } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:nlquery');

export interface NlqueryRoutesOptions {
  connectionString?: string;
}

// ─── Query Pattern Definitions ─────────────────────────────────
interface ParsedQuery {
  queryType: string;
  table: string;
  conditions: string[];
  params: any[];
  fields: string;
  orderBy: string;
  limit: number;
  description: string;
}

const DAY_NAMES: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

function parseDateRef(text: string): { start: string; end: string } | null {
  const now = new Date();
  const lower = text.toLowerCase();

  // "today"
  if (/\btoday\b/.test(lower)) {
    const s = new Date(now); s.setHours(0, 0, 0, 0);
    const e = new Date(now); e.setHours(23, 59, 59, 999);
    return { start: s.toISOString(), end: e.toISOString() };
  }
  // "yesterday"
  if (/\byesterday\b/.test(lower)) {
    const s = new Date(now); s.setDate(s.getDate() - 1); s.setHours(0, 0, 0, 0);
    const e = new Date(now); e.setDate(e.getDate() - 1); e.setHours(23, 59, 59, 999);
    return { start: s.toISOString(), end: e.toISOString() };
  }
  // "this week"
  if (/\bthis\s+week\b/.test(lower)) {
    const s = new Date(now); s.setDate(s.getDate() - s.getDay()); s.setHours(0, 0, 0, 0);
    return { start: s.toISOString(), end: now.toISOString() };
  }
  // "last week"
  if (/\blast\s+week\b/.test(lower)) {
    const s = new Date(now); s.setDate(s.getDate() - s.getDay() - 7); s.setHours(0, 0, 0, 0);
    const e = new Date(now); e.setDate(e.getDate() - e.getDay()); e.setHours(0, 0, 0, 0);
    return { start: s.toISOString(), end: e.toISOString() };
  }
  // "this month"
  if (/\bthis\s+month\b/.test(lower)) {
    const s = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: s.toISOString(), end: now.toISOString() };
  }
  // "last month"
  if (/\blast\s+month\b/.test(lower)) {
    const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const e = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: s.toISOString(), end: e.toISOString() };
  }
  // "last N days/hours"
  const lastN = lower.match(/\blast\s+(\d+)\s+(day|hour|minute|week)s?\b/);
  if (lastN) {
    const n = parseInt(lastN[1], 10);
    const unit = lastN[2];
    const ms = { day: 86400000, hour: 3600000, minute: 60000, week: 604800000 }[unit] || 86400000;
    const s = new Date(now.getTime() - n * ms);
    return { start: s.toISOString(), end: now.toISOString() };
  }
  // "last tuesday", "last friday"
  for (const [dayName, dayNum] of Object.entries(DAY_NAMES)) {
    const re = new RegExp('\\blast\\s+' + dayName + '\\b', 'i');
    if (re.test(lower)) {
      const s = new Date(now);
      let diff = (now.getDay() - dayNum + 7) % 7;
      if (diff === 0) diff = 7;
      s.setDate(s.getDate() - diff);
      s.setHours(0, 0, 0, 0);
      const e = new Date(s); e.setHours(23, 59, 59, 999);
      return { start: s.toISOString(), end: e.toISOString() };
    }
  }
  return null;
}

function parseTimeRef(text: string): { hour: number; minute: number } | null {
  const lower = text.toLowerCase();
  // "after 7pm", "before 3am", "at 14:00"
  const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1], 10);
    const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const ampm = timeMatch[3];
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    return { hour, minute };
  }
  return null;
}

function parseNaturalQuery(query: string): ParsedQuery {
  const lower = query.toLowerCase().trim();
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;
  let table = 'sync_entities';
  let fields = '*';
  let orderBy = 'updated_at DESC';
  let limit = 50;
  let queryType = 'general';
  let description = 'Search results';

  // ─── Detect query type ─────────────────────────────────
  // Access events
  if (/\b(access|accessed|badge|badged|entered|entry|swipe|swiped|tap|tapped)\b/.test(lower)) {
    table = 'sync_entities';
    conditions.push(`entity_type IN ('access_event', 'event')`);
    queryType = 'access_events';
    description = 'Access events';
    orderBy = 'updated_at DESC';
  }
  // Incidents
  else if (/\b(incident|incidents)\b/.test(lower)) {
    table = 'incidents';
    queryType = 'incidents';
    description = 'Incidents';
    orderBy = 'created_at DESC';
  }
  // Alarms
  else if (/\b(alarm|alarms|alert|alerts)\b/.test(lower)) {
    table = 'alarms';
    queryType = 'alarms';
    description = 'Alarms';
    orderBy = 'created_at DESC';
  }
  // Visitors
  else if (/\b(visitor|visitors|guest|guests|check.?in|checked.?in)\b/.test(lower)) {
    table = 'sync_entities';
    conditions.push(`entity_type = 'visitor'`);
    queryType = 'visitors';
    description = 'Visitors';
  }
  // Doors
  else if (/\b(door|doors|forced|held.?open|propped)\b/.test(lower)) {
    if (/\bforced\b/.test(lower)) {
      table = 'sync_entities';
      conditions.push(`entity_type IN ('access_event', 'event')`);
      conditions.push(`data->>'eventType' = 'door_forced'`);
      queryType = 'door_events';
      description = 'Door forced events';
    } else if (/\bheld\b/.test(lower)) {
      table = 'sync_entities';
      conditions.push(`entity_type IN ('access_event', 'event')`);
      conditions.push(`data->>'eventType' = 'door_held'`);
      queryType = 'door_events';
      description = 'Door held open events';
    } else {
      table = 'sync_entities';
      conditions.push(`entity_type = 'door_status'`);
      queryType = 'doors';
      description = 'Doors';
    }
  }
  // Cardholders / people
  else if (/\b(cardholder|cardholders|employee|employees|people|person|staff|who)\b/.test(lower)) {
    table = 'sync_entities';
    conditions.push(`entity_type = 'cardholder'`);
    queryType = 'cardholders';
    description = 'Cardholders';
  }
  // Audit log
  else if (/\b(audit|log|change|changed)\b/.test(lower)) {
    table = 'audit_log';
    queryType = 'audit';
    description = 'Audit log entries';
    orderBy = 'created_at DESC';
  }
  // "how many" — count query
  else if (/\bhow\s+many\b/.test(lower)) {
    fields = 'COUNT(*) as count';
    limit = 1;
    queryType = 'count';
    description = 'Count query';
    // Detect what to count
    if (/\b(incident|incidents)\b/.test(lower)) { table = 'incidents'; }
    else if (/\b(alarm|alarms)\b/.test(lower)) { table = 'alarms'; }
    else if (/\b(visitor|visitors)\b/.test(lower)) { table = 'sync_entities'; conditions.push(`entity_type = 'visitor'`); }
    else if (/\b(event|events|access)\b/.test(lower)) { table = 'sync_entities'; conditions.push(`entity_type IN ('access_event', 'event')`); }
    else { table = 'sync_entities'; }
  }
  // Fallback: search across entities
  else {
    table = 'sync_entities';
    queryType = 'general';
    description = 'General search results';
  }

  // ─── Extract filters ──────────────────────────────────

  // Location filter: "at [location]", "in [location]", "the [location]"
  const locationMatch = lower.match(/(?:at|in|the)\s+(?:the\s+)?([a-z0-9 ]+?(?:room|lobby|entrance|exit|gate|floor|wing|suite|building|office|hall|area|zone|deck|level|lot|garage|warehouse|lab|closet|corridor))/i);
  if (locationMatch) {
    const loc = locationMatch[1].trim();
    if (table === 'incidents') {
      conditions.push(`location ILIKE $${idx}`);
    } else if (table === 'alarms') {
      conditions.push(`(location ILIKE $${idx} OR zone ILIKE $${idx})`);
    } else if (table === 'audit_log') {
      conditions.push(`details::text ILIKE $${idx}`);
    } else {
      conditions.push(`(data::text ILIKE $${idx})`);
    }
    params.push(`%${loc}%`);
    idx++;
    description += ` at "${loc}"`;
  }

  // Person name filter: "by [name]", "for [name]", "find [name]"
  const personMatch = lower.match(/(?:by|for|find|named?|from)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  if (personMatch) {
    const person = personMatch[1].trim();
    if (table === 'incidents') {
      conditions.push(`(reported_by ILIKE $${idx} OR assigned_to ILIKE $${idx} OR title ILIKE $${idx})`);
    } else if (table === 'alarms') {
      conditions.push(`(assigned_to ILIKE $${idx} OR acknowledged_by ILIKE $${idx} OR title ILIKE $${idx})`);
    } else if (table === 'audit_log') {
      conditions.push(`(actor ILIKE $${idx} OR target_name ILIKE $${idx})`);
    } else {
      conditions.push(`data::text ILIKE $${idx}`);
    }
    params.push(`%${person}%`);
    idx++;
    description += ` for "${person}"`;
  }

  // Date filter
  const dateRef = parseDateRef(lower);
  if (dateRef) {
    const dateCol = (table === 'incidents' || table === 'alarms' || table === 'audit_log') ? 'created_at' : 'updated_at';
    conditions.push(`${dateCol} >= $${idx}`);
    params.push(dateRef.start);
    idx++;
    conditions.push(`${dateCol} <= $${idx}`);
    params.push(dateRef.end);
    idx++;

    // Also apply time-of-day filter if present
    const afterMatch = lower.match(/after\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (afterMatch) {
      const time = parseTimeRef(afterMatch[0].replace('after ', ''));
      if (time) {
        const ds = new Date(dateRef.start);
        ds.setHours(time.hour, time.minute, 0, 0);
        // Update the start condition
        params[params.length - 2] = ds.toISOString();
        description += ` after ${time.hour}:${String(time.minute).padStart(2, '0')}`;
      }
    }
    const beforeMatch = lower.match(/before\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (beforeMatch) {
      const time = parseTimeRef(beforeMatch[0].replace('before ', ''));
      if (time) {
        const de = new Date(dateRef.end);
        de.setHours(time.hour, time.minute, 0, 0);
        params[params.length - 1] = de.toISOString();
        description += ` before ${time.hour}:${String(time.minute).padStart(2, '0')}`;
      }
    }
  }
  // after-hours filter
  else if (/\bafter\s*hours?\b/.test(lower)) {
    if (table === 'sync_entities') {
      // Filter for events with after-hours timestamps (before 6am or after 6pm)
      conditions.push(`(EXTRACT(HOUR FROM updated_at) < 6 OR EXTRACT(HOUR FROM updated_at) >= 18)`);
    }
    description += ' (after hours)';
  }

  // Status filter
  const statusMatch = lower.match(/\b(open|closed|resolved|acknowledged|active|new|critical|high|medium|low)\b/);
  if (statusMatch && (table === 'incidents' || table === 'alarms')) {
    const val = statusMatch[1];
    if (['critical', 'high', 'medium', 'low'].includes(val)) {
      conditions.push(`priority = $${idx}`);
    } else {
      conditions.push(`status = $${idx}`);
    }
    params.push(val);
    idx++;
    description += ` (${val})`;
  }

  // "denied" access filter
  if (/\bdenied\b/.test(lower) && table === 'sync_entities') {
    conditions.push(`(data->>'eventType' = 'access_denied' OR data->>'accessGranted' = 'false')`);
    description = 'Denied access events';
  }

  // Limit override
  const limitMatch = lower.match(/\b(?:show|list|get|find|last|top)\s+(\d+)\b/);
  if (limitMatch) {
    limit = Math.min(parseInt(limitMatch[1], 10), 500);
  }

  return { queryType, table, conditions, params, fields, orderBy, limit, description };
}

export async function nlqueryRoutes(fastify: FastifyInstance, opts: NlqueryRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — nlquery routes disabled');
    return;
  }

  const pool = new pg.Pool({
    connectionString: connStr,
    max: 5,
    ssl: connStr.includes('sslmode=require') || connStr.includes('railway.app')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  // ─── POST /query/natural — Natural language query ──────────────
  fastify.post('/query/natural', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    const queryText = body?.query || body?.q || '';
    if (!queryText || typeof queryText !== 'string' || queryText.trim().length < 3) {
      return reply.code(400).send({ error: 'Query string is required (min 3 chars)' });
    }

    try {
      const parsed = parseNaturalQuery(queryText);

      // Defense-in-depth: the parser is the only caller that sets these, but if a
      // future change lets user text flow into them, we must never interpolate it
      // unchecked into SQL. Enforce strict allowlists here.
      const ALLOWED_TABLES = new Set(['sync_entities', 'incidents', 'alarms', 'audit_log']);
      const ALLOWED_FIELDS = new Set(['*', 'COUNT(*) as count']);
      const ALLOWED_ORDER_BY = new Set(['updated_at DESC', 'created_at DESC']);
      if (!ALLOWED_TABLES.has(parsed.table)) {
        log.warn({ table: parsed.table }, 'NL query: disallowed table rejected');
        return reply.code(400).send({ error: 'Unsupported query target' });
      }
      if (!ALLOWED_FIELDS.has(parsed.fields)) {
        log.warn({ fields: parsed.fields }, 'NL query: disallowed field list rejected');
        return reply.code(400).send({ error: 'Unsupported field list' });
      }
      if (!ALLOWED_ORDER_BY.has(parsed.orderBy)) {
        log.warn({ orderBy: parsed.orderBy }, 'NL query: disallowed ORDER BY rejected');
        return reply.code(400).send({ error: 'Unsupported sort order' });
      }
      const safeLimit = Math.min(Math.max(parseInt(String(parsed.limit), 10) || 50, 1), 500);

      // Tenant isolation: prepend an org_id predicate to every NL query so
      // natural-language searches can NEVER return another tenant's rows.
      // sync_entities uses COALESCE for legacy rows missing org_id; the
      // other three tables are strictly scoped.
      const orgId = getOrgId(request);
      const orgPlaceholder = `$${parsed.params.length + 1}`;
      const orgPredicate = parsed.table === 'sync_entities'
        ? `COALESCE(org_id, ${orgPlaceholder}) = ${orgPlaceholder}`
        : `org_id = ${orgPlaceholder}`;
      const allConditions = [...parsed.conditions, orgPredicate];
      const where = 'WHERE ' + allConditions.join(' AND ');
      const sql = `SELECT ${parsed.fields} FROM ${parsed.table} ${where} ORDER BY ${parsed.orderBy} LIMIT ${safeLimit}`;
      const sqlParams = [...parsed.params, orgId];

      log.info({ query: queryText, sql, params: sqlParams }, 'Natural language query');

      const { rows } = await pool.query(sql, sqlParams);

      // For entity results, unwrap the data column
      let results = rows;
      if (parsed.table === 'sync_entities' && parsed.fields === '*') {
        results = rows.map(r => ({ ...r.data, _entityType: r.entity_type, _updatedAt: r.updated_at }));
      }

      return reply.send({
        query: queryText,
        queryType: parsed.queryType,
        description: parsed.description,
        results,
        total: results.length,
        sql: sql.replace(/\$\d+/g, '?'), // sanitized SQL for debugging
      });
    } catch (err) {
      log.error({ err, query: queryText }, 'Natural language query failed');
      return reply.code(500).send({ error: 'Query execution failed', details: (err as Error).message });
    }
  });

  // ─── GET /query/suggestions — Example queries ──────────────────
  fastify.get('/query/suggestions', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      suggestions: [
        { query: 'Show me denied access events this week', category: 'Access Events' },
        { query: 'Who accessed restricted areas after hours?', category: 'Access Events' },
        { query: 'How many incidents this month?', category: 'Incidents' },
        { query: 'Find open incidents assigned to me', category: 'Incidents' },
        { query: 'Show critical alarms from last 24 hours', category: 'Alarms' },
        { query: 'List visitors checked in today', category: 'Visitors' },
        { query: 'Show doors forced open this week', category: 'Doors' },
        { query: 'How many alarms yesterday?', category: 'Alarms' },
        { query: 'Search cardholders by last name', category: 'Cardholders' },
        { query: 'Show after-hours access events last week', category: 'Access Events' },
        { query: 'List high priority incidents this month', category: 'Incidents' },
        { query: 'Show unresolved alarms', category: 'Alarms' },
      ],
    });
  });

  log.info('Natural language query routes registered');
}
