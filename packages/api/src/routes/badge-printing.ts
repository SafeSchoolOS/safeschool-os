import { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';

/**
 * Badge Printing API — PAID FEATURE
 *
 * Generates printable visitor badge data for thermal printers,
 * label printers (Dymo/Brother/Zebra), or browser print.
 *
 * Requires `badgePrinting` feature in SiteLicense.
 */
const badgePrintingRoutes: FastifyPluginAsync = async (app) => {

  // POST /api/v1/badges/:visitorId/generate — generate badge data
  app.post('/:visitorId/generate', {
    preHandler: [requireMinRole('OPERATOR')],
  }, async (request, reply) => {
    const { visitorId } = request.params as { visitorId: string };
    const body = request.body as {
      format?: 'html' | 'zpl' | 'escpos' | 'json';
      templateId?: string;
    };

    const visitor = await app.prisma.visitor.findUnique({
      where: { id: visitorId },
      include: { site: { include: { license: true } }, host: true },
    });

    if (!visitor) {
      return reply.code(404).send({ error: 'Visitor not found' });
    }

    // Check license
    const license = visitor.site.license;
    const isExpired = license?.expiresAt && new Date(license.expiresAt) < new Date();
    if (!license?.badgePrinting || isExpired) {
      return reply.code(403).send({
        error: 'Badge printing requires a BadgeKiosk Professional license',
        feature: 'badgePrinting',
        upgrade: true,
      });
    }

    const format = body.format || 'json';
    const badgeData = {
      visitorId: visitor.id,
      firstName: visitor.firstName,
      lastName: visitor.lastName,
      photo: visitor.photo,
      badgeNumber: visitor.badgeNumber,
      purpose: visitor.purpose,
      destination: visitor.destination,
      host: visitor.host?.name,
      siteName: visitor.site.name,
      checkedInAt: visitor.checkedInAt,
      expiresAt: visitor.checkedInAt
        ? new Date(new Date(visitor.checkedInAt).getTime() + 8 * 60 * 60 * 1000).toISOString()
        : null,
      qrCode: `SAFESCHOOL:V:${visitor.id}:${visitor.badgeNumber}`,
    };

    if (format === 'html') {
      return generateHtmlBadge(badgeData);
    }

    if (format === 'zpl') {
      return { format: 'zpl', data: generateZplBadge(badgeData) };
    }

    if (format === 'escpos') {
      return { format: 'escpos', data: generateEscPosBadge(badgeData) };
    }

    return { format: 'json', badge: badgeData };
  });

  // GET /api/v1/badges/templates — list available badge templates
  app.get('/templates', {
    preHandler: [requireMinRole('OPERATOR')],
  }, async () => {
    return {
      templates: [
        { id: 'standard', name: 'Standard Visitor', description: 'Name, photo, badge number, QR code', size: '2.25x4"' },
        { id: 'compact', name: 'Compact Badge', description: 'Name and badge number only', size: '1x3"' },
        { id: 'contractor', name: 'Contractor Badge', description: 'Name, company, badge number, expiry', size: '2.25x4"' },
        { id: 'event', name: 'Event Badge', description: 'Name, event, date', size: '4x3"' },
      ],
    };
  });

  // POST /api/v1/badges/:visitorId/print-job — queue a print job
  app.post('/:visitorId/print-job', {
    preHandler: [requireMinRole('OPERATOR')],
  }, async (request, reply) => {
    const { visitorId } = request.params as { visitorId: string };
    const body = request.body as {
      printerId?: string;
      copies?: number;
      templateId?: string;
    };

    const visitor = await app.prisma.visitor.findUnique({
      where: { id: visitorId },
      include: { site: { include: { license: true } } },
    });

    if (!visitor) {
      return reply.code(404).send({ error: 'Visitor not found' });
    }

    const license = visitor.site.license;
    const isExpired = license?.expiresAt && new Date(license.expiresAt) < new Date();
    if (!license?.badgePrinting || isExpired) {
      return reply.code(403).send({
        error: 'Badge printing requires a BadgeKiosk Professional license',
        feature: 'badgePrinting',
        upgrade: true,
      });
    }

    // Log the print job
    await app.prisma.auditLog.create({
      data: {
        siteId: visitor.siteId,
        userId: (request as any).jwtUser?.id,
        action: 'BADGE_PRINTED',
        entity: 'Visitor',
        entityId: visitorId,
        details: {
          badgeNumber: visitor.badgeNumber,
          printerId: body.printerId,
          copies: body.copies || 1,
          templateId: body.templateId || 'standard',
        },
      },
    });

    return {
      status: 'queued',
      visitorId,
      badgeNumber: visitor.badgeNumber,
      copies: body.copies || 1,
    };
  });
};

function generateHtmlBadge(badge: any): { format: string; html: string } {
  return {
    format: 'html',
    html: `<!DOCTYPE html>
<html><head><style>
  @page { size: 2.25in 4in; margin: 0; }
  body { font-family: Arial, sans-serif; margin: 0; padding: 8px; width: 2.25in; }
  .badge { border: 2px solid #000; padding: 8px; text-align: center; }
  .site-name { font-size: 10px; font-weight: bold; color: #333; margin-bottom: 4px; }
  .label { font-size: 8px; color: #666; margin-top: 4px; }
  .visitor-name { font-size: 16px; font-weight: bold; margin: 6px 0; }
  .badge-num { font-size: 20px; font-weight: bold; color: #d00; }
  .detail { font-size: 9px; color: #333; }
  .expires { font-size: 8px; color: #999; margin-top: 6px; }
  .qr { margin: 6px auto; width: 60px; height: 60px; border: 1px solid #ccc; display: flex; align-items: center; justify-content: center; font-size: 7px; color: #999; }
</style></head><body>
<div class="badge">
  <div class="site-name">${badge.siteName}</div>
  <div class="label">VISITOR</div>
  <div class="visitor-name">${badge.firstName} ${badge.lastName}</div>
  <div class="badge-num">${badge.badgeNumber || 'N/A'}</div>
  <div class="detail">Destination: ${badge.destination}</div>
  ${badge.host ? `<div class="detail">Host: ${badge.host}</div>` : ''}
  <div class="detail">Purpose: ${badge.purpose}</div>
  <div class="qr">[QR: ${badge.qrCode}]</div>
  ${badge.expiresAt ? `<div class="expires">Expires: ${new Date(badge.expiresAt).toLocaleString()}</div>` : ''}
</div>
</body></html>`,
  };
}

function generateZplBadge(badge: any): string {
  // Zebra ZPL II for thermal label printers
  return `^XA
^FO20,20^A0N,30,30^FD${badge.siteName}^FS
^FO20,60^A0N,20,20^FDVISITOR^FS
^FO20,90^A0N,40,40^FD${badge.firstName} ${badge.lastName}^FS
^FO20,140^A0N,50,50^FD${badge.badgeNumber || ''}^FS
^FO20,200^A0N,20,20^FDDest: ${badge.destination}^FS
${badge.host ? `^FO20,225^A0N,20,20^FDHost: ${badge.host}^FS` : ''}
^FO20,250^A0N,20,20^FD${badge.purpose}^FS
^FO250,140^BQN,2,4^FDQA,${badge.qrCode}^FS
${badge.expiresAt ? `^FO20,290^A0N,15,15^FDExpires: ${new Date(badge.expiresAt).toLocaleString()}^FS` : ''}
^XZ`;
}

function generateEscPosBadge(badge: any): string {
  // ESC/POS commands as hex strings for thermal receipt printers
  const ESC = '\\x1b';
  const GS = '\\x1d';
  return [
    `${ESC}@`, // Initialize
    `${ESC}a\\x01`, // Center align
    `${ESC}E\\x01`, // Bold on
    badge.siteName,
    `${ESC}E\\x00`, // Bold off
    '\\n',
    'VISITOR',
    '\\n',
    `${GS}!\\x11`, // Double height + width
    `${badge.firstName} ${badge.lastName}`,
    `${GS}!\\x00`, // Normal size
    '\\n',
    `${GS}!\\x01`, // Double height
    badge.badgeNumber || '',
    `${GS}!\\x00`,
    '\\n',
    `Dest: ${badge.destination}`,
    '\\n',
    badge.host ? `Host: ${badge.host}\\n` : '',
    badge.purpose,
    '\\n',
    badge.expiresAt ? `Exp: ${new Date(badge.expiresAt).toLocaleString()}\\n` : '',
    `${GS}V\\x42\\x00`, // Cut paper
  ].join('');
}

export default badgePrintingRoutes;
