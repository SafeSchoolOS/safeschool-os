import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { sanitizeText } from '../utils/sanitize.js';
import { requireMinRole } from '../middleware/rbac.js';

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

function hashPhone(phone: string): string {
  return createHash('sha256').update(phone.trim()).digest('hex');
}

const CATEGORY_MENU = [
  { num: 1, key: 'THREAT_OF_VIOLENCE', label: 'Threat of Violence' },
  { num: 2, key: 'WEAPON', label: 'Weapon' },
  { num: 3, key: 'BULLYING_TIP', label: 'Bullying' },
  { num: 4, key: 'DRUGS_TIP', label: 'Drugs/Alcohol' },
  { num: 5, key: 'SELF_HARM_TIP', label: 'Self-Harm/Suicide' },
  { num: 6, key: 'SUSPICIOUS_PERSON', label: 'Suspicious Person' },
  { num: 7, key: 'SUSPICIOUS_PACKAGE', label: 'Suspicious Package' },
  { num: 8, key: 'INFRASTRUCTURE_TIP', label: 'Infrastructure/Safety Issue' },
  { num: 9, key: 'OTHER_TIP', label: 'Other' },
];

const CATEGORY_LABELS: Record<string, string> = {};
for (const item of CATEGORY_MENU) {
  CATEGORY_LABELS[item.key] = item.label;
}

const SOURCE_MAP: Record<string, string> = {
  wetip: 'WEBHOOK_WETIP',
  stopit: 'WEBHOOK_STOPIT',
  saysomething: 'WEBHOOK_SAY_SOMETHING',
  custom: 'WEBHOOK_CUSTOM',
};

function twiml(message: string): string {
  return `<Response><Message>${message}</Message></Response>`;
}

function buildCategoryMenuText(): string {
  const lines = CATEGORY_MENU.map((c) => `${c.num}. ${c.label}`);
  return `What category best describes your tip?\n${lines.join('\n')}\n\nReply with a number 1-9.`;
}

/**
 * Creates a preHandler that authenticates webhook requests via X-API-Key header
 * using timing-safe comparison against stored TipWebhookConfig.
 */
function authenticateWebhook(source: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const apiKey = request.headers['x-api-key'] as string | undefined;
    if (!apiKey) {
      return reply.status(401).send({ error: 'Missing X-API-Key header' });
    }

    const config = await (request.server as any).prisma.tipWebhookConfig.findFirst({
      where: { source, enabled: true },
    });

    if (!config) {
      return reply.status(404).send({ error: 'No webhook configuration found for this source' });
    }

    // Timing-safe comparison
    const expected = Buffer.from(config.apiKey, 'utf8');
    const provided = Buffer.from(apiKey, 'utf8');
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      return reply.status(401).send({ error: 'Invalid API key' });
    }

    // Attach config to request for downstream use
    (request as any).webhookConfig = config;
  };
}

const frTipsIntegrationsRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── SMS Tip Line (no auth — Twilio webhooks) ───────────────────────

  // POST /sms/inbound — Receive inbound SMS from Twilio
  fastify.post('/sms/inbound', {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const body = request.body as {
      From?: string;
      Body?: string;
      MessageSid?: string;
    };

    const from = body.From || '';
    const msgBody = (body.Body || '').trim();
    const messageSid = body.MessageSid || null;

    if (!from || !msgBody) {
      return reply.type('text/xml').send(twiml('Invalid request.'));
    }

    const phoneHash = hashPhone(from);
    const now = new Date();

    // Find active conversation or start a new one
    let conversation = await fastify.prisma.smsTipConversation.findFirst({
      where: {
        phoneHash,
        expiresAt: { gt: now },
        state: {
          notIn: ['COMPLETED_SMS', 'EXPIRED_SMS', 'CANCELLED_SMS'],
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // If conversation is in a terminal state or doesn't exist, create new one
    if (!conversation) {
      conversation = await fastify.prisma.smsTipConversation.create({
        data: {
          phoneHash,
          state: 'AWAITING_SCHOOL',
          lastMessageAt: now,
          expiresAt: new Date(now.getTime() + 30 * 60 * 1000), // 30 minutes
        },
      });
    }

    // Record inbound message
    await fastify.prisma.smsTipMessage.create({
      data: {
        conversationId: conversation.id,
        direction: 'INBOUND',
        body: msgBody,
        twilioSid: messageSid,
      },
    });

    let replyText = '';

    switch (conversation.state) {
      case 'AWAITING_SCHOOL': {
        // Match body against site names (case-insensitive partial match)
        const sites = await fastify.prisma.site.findMany({
          select: { id: true, name: true },
        });

        const normalizedBody = msgBody.toLowerCase();
        const matched = sites.find((s) =>
          s.name.toLowerCase().includes(normalizedBody) ||
          normalizedBody.includes(s.name.toLowerCase())
        );

        if (matched) {
          await fastify.prisma.smsTipConversation.update({
            where: { id: conversation.id },
            data: {
              siteId: matched.id,
              state: 'AWAITING_CATEGORY',
              lastMessageAt: now,
              expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
            },
          });
          replyText = `School: ${matched.name}\n\n${buildCategoryMenuText()}`;
        } else {
          replyText = 'We could not find that school. Please reply with the name of the school you are reporting about.';
        }
        break;
      }

      case 'AWAITING_CATEGORY': {
        const num = parseInt(msgBody, 10);
        const categoryItem = CATEGORY_MENU.find((c) => c.num === num);

        if (!categoryItem) {
          replyText = `Please reply with a number 1-9.\n\n${buildCategoryMenuText()}`;
        } else {
          await fastify.prisma.smsTipConversation.update({
            where: { id: conversation.id },
            data: {
              category: categoryItem.key,
              state: 'AWAITING_CONTENT',
              lastMessageAt: now,
              expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
            },
          });
          replyText = 'Describe what you saw or heard. Be as specific as possible.';
        }
        break;
      }

      case 'AWAITING_CONTENT': {
        const sanitized = sanitizeText(msgBody);
        if (sanitized.length < 10) {
          replyText = 'Please provide more detail (at least 10 characters).';
        } else {
          await fastify.prisma.smsTipConversation.update({
            where: { id: conversation.id },
            data: {
              content: sanitized,
              state: 'AWAITING_CONFIRM',
              lastMessageAt: now,
              expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
            },
          });

          const categoryLabel = CATEGORY_LABELS[conversation.category || ''] || conversation.category;
          replyText = `Summary:\nCategory: ${categoryLabel}\nDetails: ${sanitized}\n\nReply YES to submit or NO to cancel.`;
        }
        break;
      }

      case 'AWAITING_CONFIRM': {
        const normalized = msgBody.toUpperCase().trim();

        if (normalized === 'YES' || normalized === 'Y') {
          // Generate tracking code with collision retry
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
              action: 'Tip submitted via SMS',
              isPublic: true,
            },
          ];

          const tip = await fastify.prisma.fRTip.create({
            data: {
              trackingCode,
              siteId: conversation.siteId || null,
              source: 'TEXT_SMS',
              category: (conversation.category || 'OTHER_TIP') as any,
              content: conversation.content || '',
              isAnonymous: true,
              severity: 'MEDIUM',
              status: 'NEW_TIP',
              timeline: initialTimeline,
            },
          });

          await fastify.prisma.smsTipConversation.update({
            where: { id: conversation.id },
            data: {
              tipId: tip.id,
              state: 'COMPLETED_SMS',
              lastMessageAt: now,
            },
          });

          replyText = `Your tip has been submitted. Tracking code: ${trackingCode}. Save this code to check your tip status. Thank you for keeping our schools safe.`;
        } else if (normalized === 'NO' || normalized === 'N' || normalized === 'CANCEL') {
          await fastify.prisma.smsTipConversation.update({
            where: { id: conversation.id },
            data: {
              state: 'CANCELLED_SMS',
              lastMessageAt: now,
            },
          });
          replyText = 'Your tip has been cancelled. Text again anytime to submit a new tip.';
        } else {
          replyText = 'Please reply YES to submit your tip or NO to cancel.';
        }
        break;
      }

      default: {
        // Terminal states — start fresh next message
        replyText = 'Welcome to SafeSchool Tip Line. Reply with the name of the school you want to report about.';
        break;
      }
    }

    // Record outbound reply
    await fastify.prisma.smsTipMessage.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        body: replyText,
      },
    });

    return reply.type('text/xml').send(twiml(replyText));
  });

  // POST /sms/status — Twilio delivery status callback
  fastify.post('/sms/status', async (request, reply) => {
    const body = request.body as {
      MessageSid?: string;
      MessageStatus?: string;
    };

    if (body.MessageSid && body.MessageStatus) {
      await fastify.prisma.smsTipMessage.updateMany({
        where: { twilioSid: body.MessageSid },
        data: { status: body.MessageStatus },
      });
    }

    return reply.status(200).send({ ok: true });
  });

  // ─── Third-Party Webhooks (API key auth) ─────────────────────────────

  // POST /webhook/:source — Receive tip from third-party platform
  fastify.post<{ Params: { source: string } }>('/webhook/:source', {
    preHandler: [
      async (request: FastifyRequest<{ Params: { source: string } }>, reply: FastifyReply) => {
        const { source } = request.params;
        const mappedSource = SOURCE_MAP[source.toLowerCase()];
        if (!mappedSource) {
          return reply.status(400).send({ error: `Unknown webhook source: ${source}` });
        }
        // Run the webhook authenticator for this source
        await authenticateWebhook(mappedSource)(request, reply);
      },
    ],
  }, async (request, reply) => {
    const { source } = request.params as { source: string };
    const mappedSource = SOURCE_MAP[source.toLowerCase()];
    const config = (request as any).webhookConfig;

    const body = request.body as {
      externalId?: string;
      content: string;
      category?: string;
      severity?: string;
      isAnonymous?: boolean;
      tipsterContact?: string;
      schoolName?: string;
      schoolExternalId?: string;
      attachments?: string[];
      metadata?: Record<string, any>;
    };

    if (!body.content) {
      return reply.status(400).send({ error: 'content is required' });
    }

    const content = sanitizeText(body.content);

    // Resolve school
    let siteId: string | null = null;

    if (body.schoolName) {
      const normalizedName = body.schoolName.toLowerCase();
      const sites = await fastify.prisma.site.findMany({
        select: { id: true, name: true },
      });
      const matched = sites.find((s) =>
        s.name.toLowerCase().includes(normalizedName) ||
        normalizedName.includes(s.name.toLowerCase())
      );
      if (matched) {
        siteId = matched.id;
      }
    }

    // Fall back to config's schoolExternalId if no schoolName match
    if (!siteId && (body.schoolExternalId || config.schoolExternalId)) {
      const extId = body.schoolExternalId || config.schoolExternalId;
      const site = await fastify.prisma.site.findFirst({
        where: { id: extId },
        select: { id: true },
      });
      if (site) {
        siteId = site.id;
      }
    }

    // Fall back to config's siteId
    if (!siteId) {
      siteId = config.siteId;
    }

    // Map category using config.categoryMapping, fallback to config.defaultCategory
    let category = config.defaultCategory || 'OTHER_TIP';
    if (body.category) {
      const mapping = (config.categoryMapping || {}) as Record<string, string>;
      if (mapping[body.category]) {
        category = mapping[body.category];
      } else if (CATEGORY_LABELS[body.category.toUpperCase()]) {
        // Direct match on enum key
        category = body.category.toUpperCase();
      }
    }

    // Generate tracking code with collision retry
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
        action: `Tip received via ${source} webhook`,
        isPublic: true,
      },
    ];

    const tip = await fastify.prisma.fRTip.create({
      data: {
        trackingCode,
        siteId,
        source: mappedSource as any,
        category: category as any,
        content,
        attachments: body.attachments || [],
        tipsterContact: body.tipsterContact ? sanitizeText(body.tipsterContact) : null,
        isAnonymous: body.isAnonymous !== false,
        severity: (body.severity as any) || 'MEDIUM',
        status: 'NEW_TIP',
        timeline: initialTimeline,
      },
    });

    // Update webhook config stats
    await fastify.prisma.tipWebhookConfig.update({
      where: { id: config.id },
      data: {
        lastReceivedAt: new Date(),
        totalReceived: { increment: 1 },
      },
    });

    return reply.status(201).send({
      id: tip.id,
      trackingCode: tip.trackingCode,
    });
  });

  // ─── Webhook Config (admin auth, SITE_ADMIN+) ───────────────────────

  // GET /webhook/config — List webhook configs for a site
  fastify.get('/webhook/config', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const query = request.query as { siteId?: string };

    if (!query.siteId) {
      return reply.status(400).send({ error: 'siteId query parameter is required' });
    }

    const configs = await fastify.prisma.tipWebhookConfig.findMany({
      where: { siteId: query.siteId },
      orderBy: { source: 'asc' },
    });

    return reply.send(configs);
  });

  // PUT /webhook/config/:source — Upsert webhook config
  fastify.put<{ Params: { source: string } }>('/webhook/config/:source', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const { source } = request.params;

    const body = request.body as {
      siteId: string;
      enabled?: boolean;
      apiKey?: string;
      categoryMapping?: Record<string, string>;
      defaultCategory?: string;
      schoolExternalId?: string;
    };

    if (!body.siteId) {
      return reply.status(400).send({ error: 'siteId is required' });
    }

    const mappedSource = SOURCE_MAP[source.toLowerCase()];
    if (!mappedSource) {
      return reply.status(400).send({ error: `Unknown webhook source: ${source}` });
    }

    const data: any = {};
    if (body.enabled !== undefined) data.enabled = body.enabled;
    if (body.apiKey !== undefined) data.apiKey = sanitizeText(body.apiKey);
    if (body.categoryMapping !== undefined) data.categoryMapping = body.categoryMapping;
    if (body.defaultCategory !== undefined) data.defaultCategory = sanitizeText(body.defaultCategory);
    if (body.schoolExternalId !== undefined) data.schoolExternalId = sanitizeText(body.schoolExternalId);

    const config = await fastify.prisma.tipWebhookConfig.upsert({
      where: {
        siteId_source: {
          siteId: body.siteId,
          source: mappedSource,
        },
      },
      update: data,
      create: {
        siteId: body.siteId,
        source: mappedSource,
        enabled: body.enabled ?? false,
        apiKey: body.apiKey || '',
        categoryMapping: body.categoryMapping || {},
        defaultCategory: body.defaultCategory || 'OTHER_TIP',
        schoolExternalId: body.schoolExternalId || null,
        ...data,
      },
    });

    // Audit log
    await fastify.prisma.auditLog.create({
      data: {
        siteId: body.siteId,
        userId: request.jwtUser.id,
        action: 'WEBHOOK_CONFIG_UPDATED',
        entity: 'TipWebhookConfig',
        entityId: config.id,
        details: { source: mappedSource, changes: Object.keys(data) },
        ipAddress: request.ip,
      },
    });

    return reply.send(config);
  });
};

export default frTipsIntegrationsRoutes;
