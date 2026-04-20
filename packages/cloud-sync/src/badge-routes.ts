// @ts-nocheck
/**
 * Badge Print API Routes
 *
 * Provides badge printing endpoints for the badge designer:
 *   - POST   /print              — Send a badge to the print queue
 *   - GET    /print-queue        — List print jobs
 *   - GET    /print-agents       — List connected print agents
 *   - POST   /preview            — Render a badge preview (returns data URL)
 *   - GET    /templates          — List saved badge templates
 *   - POST   /templates          — Save a badge template
 *   - DELETE /templates/:id      — Delete a badge template
 */

import crypto from 'node:crypto';
import { createLogger } from '@edgeruntime/core';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

const log = createLogger('cloud-sync:badges');

// ─── Types (mirror BadgeDesignAdapter types) ─────────────────────────

interface BadgeElement {
  id: string;
  type: 'text' | 'image' | 'barcode' | 'qrcode' | 'photo' | 'shape' | 'logo';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  properties: Record<string, unknown>;
}

interface BadgeTemplate {
  id: string;
  name: string;
  width: number;
  height: number;
  orientation: 'landscape' | 'portrait';
  background?: string;
  elements: BadgeElement[];
  createdAt: string;
  updatedAt: string;
}

interface BadgeData {
  firstName: string;
  lastName: string;
  photo?: string;
  title?: string;
  department?: string;
  company?: string;
  badgeNumber?: string;
  accessLevel?: string;
  validFrom?: string;
  validUntil?: string;
  [key: string]: unknown;
}

interface PrintJob {
  id: string;
  templateId: string;
  templateName: string;
  cardholder: string;
  status: 'queued' | 'printing' | 'completed' | 'failed';
  data: BadgeData;
  createdAt: string;
  completedAt?: string;
  agentId?: string;
  error?: string;
}

interface PrintAgent {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'busy';
  printerModel: string;
  lastSeen: string;
}

// ─── In-memory stores ────────────────────────────────────────────────

const savedTemplates: Map<string, BadgeTemplate> = new Map();
const printJobs: Map<string, PrintJob> = new Map();
const printAgents: Map<string, PrintAgent> = new Map();

// Seed demo print agents
function ensureDemoAgents(): void {
  if (printAgents.size > 0) return;
  const now = new Date().toISOString();
  printAgents.set('agent-1', {
    id: 'agent-1',
    name: 'Front Desk Printer',
    status: 'online',
    printerModel: 'Fargo DTC4500e',
    lastSeen: now,
  });
  printAgents.set('agent-2', {
    id: 'agent-2',
    name: 'Security Office Printer',
    status: 'online',
    printerModel: 'Zebra ZC300',
    lastSeen: now,
  });
}

// Seed demo print jobs
function ensureDemoJobs(): void {
  if (printJobs.size > 0) return;
  const now = new Date();
  const jobs: PrintJob[] = [
    {
      id: crypto.randomUUID(),
      templateId: 'visitor',
      templateName: 'Visitor Badge',
      cardholder: 'Jane Smith',
      status: 'completed',
      data: { firstName: 'Jane', lastName: 'Smith', company: 'Acme Corp', badgeNumber: '10042' },
      createdAt: new Date(now.getTime() - 3600000).toISOString(),
      completedAt: new Date(now.getTime() - 3590000).toISOString(),
      agentId: 'agent-1',
    },
    {
      id: crypto.randomUUID(),
      templateId: 'staff-id',
      templateName: 'Staff ID Badge',
      cardholder: 'John Doe',
      status: 'completed',
      data: { firstName: 'John', lastName: 'Doe', department: 'Engineering', badgeNumber: '28491' },
      createdAt: new Date(now.getTime() - 1800000).toISOString(),
      completedAt: new Date(now.getTime() - 1790000).toISOString(),
      agentId: 'agent-2',
    },
    {
      id: crypto.randomUUID(),
      templateId: 'contractor',
      templateName: 'Contractor Badge',
      cardholder: 'Bob Wilson',
      status: 'queued',
      data: { firstName: 'Bob', lastName: 'Wilson', company: 'BuildCo', badgeNumber: '50123' },
      createdAt: new Date(now.getTime() - 30000).toISOString(),
    },
  ];
  for (const job of jobs) {
    printJobs.set(job.id, job);
  }
}

// ─── Route Options ───────────────────────────────────────────────────

export interface BadgeRoutesOptions {
  connectionString?: string;
}

// ─── Plugin ──────────────────────────────────────────────────────────

export async function badgeRoutes(fastify: FastifyInstance, _opts: BadgeRoutesOptions) {
  // Ensure demo data is seeded
  ensureDemoAgents();
  ensureDemoJobs();

  // ─── POST /print — Send badge to print queue ──────────────────

  fastify.post('/print', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    if (!body?.data || (!body?.templateId && !body?.template)) {
      return reply.code(400).send({ error: 'Provide templateId or template, and data (BadgeData)' });
    }

    const data: BadgeData = body.data;
    const cardholder = `${data.firstName || ''} ${data.lastName || ''}`.trim() || 'Unknown';

    // Resolve template
    let templateId: string;
    let templateName: string;

    if (body.templateId) {
      const saved = savedTemplates.get(body.templateId);
      templateId = body.templateId;
      templateName = saved?.name || body.templateId;
    } else {
      const tpl: BadgeTemplate = body.template;
      templateId = tpl.id || crypto.randomUUID();
      templateName = tpl.name || 'Unnamed Template';
    }

    const jobId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Find an available print agent
    const availableAgent = Array.from(printAgents.values()).find(a => a.status === 'online');

    const job: PrintJob = {
      id: jobId,
      templateId,
      templateName,
      cardholder,
      status: availableAgent ? 'queued' : 'queued',
      data,
      createdAt: now,
      agentId: availableAgent?.id,
    };

    printJobs.set(jobId, job);

    log.info({ jobId, cardholder, templateId, agentId: availableAgent?.id }, 'Badge print job created');

    // Simulate async print completion (demo mode)
    setTimeout(() => {
      const j = printJobs.get(jobId);
      if (j && j.status === 'queued') {
        j.status = 'printing';
        setTimeout(() => {
          const j2 = printJobs.get(jobId);
          if (j2 && j2.status === 'printing') {
            j2.status = 'completed';
            j2.completedAt = new Date().toISOString();
            log.info({ jobId }, 'Badge print job completed (demo)');
          }
        }, 3000);
      }
    }, 1000);

    return reply.send({
      success: true,
      jobId,
      status: job.status,
      agent: availableAgent ? { id: availableAgent.id, name: availableAgent.name } : null,
    });
  });

  // ─── GET /print-queue — List print jobs ────────────────────────

  fastify.get('/print-queue', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { status?: string; limit?: string };
    let jobs = Array.from(printJobs.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    if (query.status) {
      jobs = jobs.filter(j => j.status === query.status);
    }

    const limit = parseInt(query.limit || '50', 10);
    jobs = jobs.slice(0, limit);

    return reply.send({
      jobs: jobs.map(j => ({
        id: j.id,
        templateId: j.templateId,
        templateName: j.templateName,
        cardholder: j.cardholder,
        status: j.status,
        createdAt: j.createdAt,
        completedAt: j.completedAt,
        agentId: j.agentId,
      })),
      total: printJobs.size,
    });
  });

  // ─── GET /print-agents — List connected print agents ──────────

  fastify.get('/print-agents', async (_request: FastifyRequest, reply: FastifyReply) => {
    const agents = Array.from(printAgents.values());
    return reply.send({
      agents: agents.map(a => ({
        id: a.id,
        name: a.name,
        status: a.status,
        printerModel: a.printerModel,
        lastSeen: a.lastSeen,
      })),
    });
  });

  // ─── POST /preview — Render badge preview (placeholder) ───────

  fastify.post('/preview', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    if (!body?.template || !body?.data) {
      return reply.code(400).send({ error: 'Provide template (BadgeTemplate) and data (BadgeData)' });
    }

    const tpl: BadgeTemplate = body.template;
    const data: BadgeData = body.data;

    // Generate a simple SVG preview as a data URL
    // In production, this would use CanvasRendererAdapter for full rendering
    const w = tpl.width * 4;
    const h = tpl.height * 4;
    const bg = (tpl.background || '#1e293b').indexOf('gradient') >= 0
      ? '#1e3a5f'
      : (tpl.background || '#1e293b');

    let svgElements = '';
    for (const el of tpl.elements) {
      const ex = el.x * 4;
      const ey = el.y * 4;
      const ew = el.width * 4;
      const eh = el.height * 4;

      if (el.type === 'text') {
        const content = String(el.properties.content || '')
          .replace(/\{\{(\w+)\}\}/g, (_, k) => (data as any)[k] || k);
        const fontSize = ((el.properties.fontSize as number) || 8) * 1.5;
        const color = (el.properties.color as string) || '#ffffff';
        svgElements += `<text x="${ex + 2}" y="${ey + fontSize + 2}" font-size="${fontSize}" fill="${color}" font-family="sans-serif">${escapeXml(content)}</text>`;
      } else if (el.type === 'shape') {
        const fill = (el.properties.fill as string) || '#334155';
        svgElements += `<rect x="${ex}" y="${ey}" width="${ew}" height="${eh}" fill="${fill}"/>`;
      } else if (el.type === 'photo') {
        svgElements += `<rect x="${ex}" y="${ey}" width="${ew}" height="${eh}" fill="#334155" rx="4"/>`;
        svgElements += `<text x="${ex + ew / 2}" y="${ey + eh / 2 + 4}" text-anchor="middle" font-size="12" fill="#64748b">Photo</text>`;
      } else if (el.type === 'barcode') {
        svgElements += `<rect x="${ex}" y="${ey}" width="${ew}" height="${eh}" fill="#ffffff" rx="2"/>`;
        // Draw simple barcode lines
        for (let i = 0; i < ew - 4; i += 3) {
          svgElements += `<rect x="${ex + 2 + i}" y="${ey + 2}" width="1.5" height="${eh - 4}" fill="#111111"/>`;
        }
      } else if (el.type === 'qrcode') {
        svgElements += `<rect x="${ex}" y="${ey}" width="${ew}" height="${eh}" fill="#ffffff" rx="2"/>`;
        svgElements += `<text x="${ex + ew / 2}" y="${ey + eh / 2 + 4}" text-anchor="middle" font-size="8" fill="#111111">QR</text>`;
      } else if (el.type === 'logo') {
        svgElements += `<rect x="${ex}" y="${ey}" width="${ew}" height="${eh}" fill="#1e293b" rx="4"/>`;
        svgElements += `<text x="${ex + ew / 2}" y="${ey + eh / 2 + 5}" text-anchor="middle" font-size="14" fill="#475569">&#9678;</text>`;
      }
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <rect width="${w}" height="${h}" fill="${bg}" rx="8"/>
      ${svgElements}
    </svg>`;

    const base64 = Buffer.from(svg).toString('base64');
    const preview = `data:image/svg+xml;base64,${base64}`;

    return reply.send({ preview });
  });

  // ─── GET /templates — List saved badge templates ───────────────

  fastify.get('/templates', async (_request: FastifyRequest, reply: FastifyReply) => {
    const templates = Array.from(savedTemplates.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    return reply.send({ templates, total: templates.length });
  });

  // ─── POST /templates — Save a badge template ──────────────────

  fastify.post('/templates', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    if (!body?.name || !body?.elements) {
      return reply.code(400).send({ error: 'Provide name and elements at minimum' });
    }

    const now = new Date().toISOString();
    const id = body.id || crypto.randomUUID();
    const existing = savedTemplates.get(id);

    const template: BadgeTemplate = {
      id,
      name: body.name,
      width: body.width || 85.6,
      height: body.height || 53.98,
      orientation: body.orientation || 'landscape',
      background: body.background || '#1e293b',
      elements: body.elements,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    savedTemplates.set(id, template);

    log.info({ templateId: id, name: template.name, elementCount: template.elements.length },
      existing ? 'Badge template updated' : 'Badge template saved');

    return reply.send({ success: true, template });
  });

  // ─── DELETE /templates/:id — Delete a badge template ──────────

  fastify.delete('/templates/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    if (!savedTemplates.has(id)) {
      return reply.code(404).send({ error: 'Template not found' });
    }

    savedTemplates.delete(id);
    log.info({ templateId: id }, 'Badge template deleted');

    return reply.send({ success: true, deleted: id });
  });

  log.info('Badge print routes registered');
}

// ─── Helpers ─────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
