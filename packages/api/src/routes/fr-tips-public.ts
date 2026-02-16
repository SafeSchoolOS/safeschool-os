import type { FastifyPluginAsync } from 'fastify';
import { randomBytes } from 'crypto';
import { sanitizeText } from '../utils/sanitize.js';

// Characters excluding I, O, 0, 1 to avoid confusion
const TRACKING_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateTrackingCode(): string {
  const bytes = randomBytes(6);
  let code = 'TIP-';
  for (let i = 0; i < 6; i++) {
    code += TRACKING_CHARS[bytes[i] % TRACKING_CHARS.length];
  }
  return code;
}

const CATEGORY_LABELS: Record<string, string> = {
  THREAT_OF_VIOLENCE: 'Threat of Violence',
  WEAPON: 'Weapon',
  BULLYING_TIP: 'Bullying',
  DRUGS_TIP: 'Drugs/Alcohol',
  SELF_HARM_TIP: 'Self-Harm/Suicide',
  SUSPICIOUS_PERSON: 'Suspicious Person',
  SUSPICIOUS_PACKAGE: 'Suspicious Package',
  INFRASTRUCTURE_TIP: 'Infrastructure/Safety Issue',
  OTHER_TIP: 'Other',
};

const frTipsPublicRoutes: FastifyPluginAsync = async (fastify) => {
  // POST / — Submit anonymous tip (no auth, rate limited)
  fastify.post('/', {
    config: {
      rateLimit: {
        max: 3,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const body = request.body as {
      siteId?: string;
      category: string;
      content: string;
      tipsterContact?: string;
      isAnonymous?: boolean;
      severity?: string;
      source?: string;
      attachments?: string[];
    };

    if (!body.category || !body.content) {
      return reply.status(400).send({ error: 'category and content are required' });
    }

    if (!CATEGORY_LABELS[body.category]) {
      return reply.status(400).send({ error: 'Invalid category' });
    }

    const content = sanitizeText(body.content);
    if (content.length < 10) {
      return reply.status(400).send({ error: 'Content must be at least 10 characters' });
    }

    const tipsterContact = body.tipsterContact ? sanitizeText(body.tipsterContact) : null;
    const isAnonymous = body.isAnonymous !== false;
    const severity = body.severity || 'MEDIUM';
    const source = body.source || 'WEB_FORM';
    const attachments = body.attachments || [];

    // Generate unique tracking code with retry on collision
    let trackingCode = generateTrackingCode();
    let attempts = 0;
    while (attempts < 5) {
      const existing = await fastify.prisma.fRTip.findUnique({
        where: { trackingCode },
      });
      if (!existing) break;
      trackingCode = generateTrackingCode();
      attempts++;
    }

    const initialTimeline = [
      {
        timestamp: new Date().toISOString(),
        action: 'Tip submitted',
        isPublic: true,
      },
    ];

    const status = severity === 'CRITICAL' ? 'UNDER_REVIEW_TIP' : 'NEW_TIP';

    const tip = await fastify.prisma.fRTip.create({
      data: {
        trackingCode,
        siteId: body.siteId || null,
        source: source as any,
        category: body.category as any,
        content,
        attachments,
        tipsterContact,
        isAnonymous,
        severity: severity as any,
        status: status as any,
        timeline: initialTimeline,
      },
    });

    return reply.status(201).send({
      id: tip.id,
      trackingCode: tip.trackingCode,
      status: tip.status,
      createdAt: tip.createdAt,
    });
  });

  // GET /categories — List tip categories with human-readable labels
  fastify.get('/categories', async (_request, reply) => {
    const categories = Object.entries(CATEGORY_LABELS).map(([value, label]) => ({
      value,
      label,
    }));
    return reply.send(categories);
  });

  // GET /track/:trackingCode — Check tip status (public-safe fields only)
  fastify.get('/track/:trackingCode', async (request, reply) => {
    const { trackingCode } = request.params as { trackingCode: string };

    const tip = await fastify.prisma.fRTip.findUnique({
      where: { trackingCode },
      select: {
        trackingCode: true,
        status: true,
        publicStatusMessage: true,
        category: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!tip) {
      return reply.status(404).send({ error: 'Tip not found' });
    }

    return reply.send(tip);
  });

  // POST /track/:trackingCode/followup — Submit additional info on a tip
  fastify.post('/track/:trackingCode/followup', {
    config: {
      rateLimit: {
        max: 3,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const { trackingCode } = request.params as { trackingCode: string };
    const body = request.body as {
      content: string;
      attachments?: string[];
    };

    if (!body.content) {
      return reply.status(400).send({ error: 'content is required' });
    }

    const content = sanitizeText(body.content);
    if (content.length < 5) {
      return reply.status(400).send({ error: 'Content must be at least 5 characters' });
    }

    const tip = await fastify.prisma.fRTip.findUnique({
      where: { trackingCode },
    });

    if (!tip) {
      return reply.status(404).send({ error: 'Tip not found' });
    }

    const attachments = body.attachments || [];

    await fastify.prisma.tipFollowUp.create({
      data: {
        tipId: tip.id,
        source: 'TRACKING_PAGE',
        content,
        attachments,
      },
    });

    // Append to timeline
    const existingTimeline = (tip.timeline as any[]) || [];
    const updatedTimeline = [
      ...existingTimeline,
      {
        timestamp: new Date().toISOString(),
        action: 'Follow-up submitted',
        isPublic: true,
      },
    ];

    await fastify.prisma.fRTip.update({
      where: { id: tip.id },
      data: { timeline: updatedTimeline },
    });

    return reply.status(201).send({
      message: 'Follow-up submitted successfully',
    });
  });

  // GET /schools — List schools for tip submission dropdown
  fastify.get('/schools', async (_request, reply) => {
    const sites = await fastify.prisma.site.findMany({
      select: {
        id: true,
        name: true,
        district: true,
        city: true,
        state: true,
      },
      orderBy: { name: 'asc' },
    });

    return reply.send(sites);
  });
};

export default frTipsPublicRoutes;
