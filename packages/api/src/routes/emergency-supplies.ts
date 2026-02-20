import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

const emergencySupplyRoutes: FastifyPluginAsync = async (fastify) => {
  // ── List supplies ─────────────────────────────────────────────────────
  fastify.get<{
    Querystring: { siteId?: string; type?: string; status?: string; buildingId?: string; expiringSoon?: string };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const { siteId, type, status, buildingId, expiringSoon } = request.query;
    const where: any = { siteId: { in: request.jwtUser.siteIds }, isActive: true };
    if (siteId) where.siteId = siteId;
    if (type) where.type = type;
    if (status) where.status = status;
    if (buildingId) where.buildingId = buildingId;
    if (expiringSoon === 'true') {
      const sixtyDaysOut = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
      where.expiresAt = { lte: sixtyDaysOut, gt: new Date() };
    }

    return fastify.prisma.emergencySupply.findMany({
      where,
      include: {
        _count: { select: { items: true, inspections: true } },
      },
      orderBy: [{ type: 'asc' }, { location: 'asc' }],
    });
  });

  // ── Get single supply with items ──────────────────────────────────────
  fastify.get<{
    Params: { supplyId: string };
  }>('/:supplyId', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const supply = await fastify.prisma.emergencySupply.findFirst({
      where: { id: request.params.supplyId, siteId: { in: request.jwtUser.siteIds } },
      include: {
        items: { orderBy: { name: 'asc' } },
        inspections: { orderBy: { inspectedAt: 'desc' }, take: 5 },
        usageLogs: { orderBy: { usedAt: 'desc' }, take: 5 },
      },
    });
    if (!supply) return reply.code(404).send({ error: 'Supply not found' });
    return supply;
  });

  // ── Create supply ─────────────────────────────────────────────────────
  fastify.post<{
    Body: {
      siteId: string;
      buildingId?: string;
      roomId?: string;
      type: string;
      name: string;
      serialNumber?: string;
      manufacturer?: string;
      model?: string;
      location: string;
      floor?: number;
      mapX?: number;
      mapY?: number;
      expiresAt?: string;
      nextInspectionDue?: string;
      notes?: string;
    };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const { siteId, expiresAt, nextInspectionDue, name, location, notes, ...rest } = request.body;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const supply = await fastify.prisma.emergencySupply.create({
      data: {
        siteId,
        name: sanitizeText(name),
        location: sanitizeText(location),
        notes: notes ? sanitizeText(notes) : null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        nextInspectionDue: nextInspectionDue ? new Date(nextInspectionDue) : null,
        type: rest.type as any,
        ...rest,
      },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'EMERGENCY_SUPPLY_CREATED',
        entity: 'EmergencySupply',
        entityId: supply.id,
        details: { type: rest.type, name, location },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(supply);
  });

  // ── Update supply ─────────────────────────────────────────────────────
  fastify.patch<{
    Params: { supplyId: string };
    Body: {
      status?: string;
      location?: string;
      expiresAt?: string;
      nextInspectionDue?: string;
      notes?: string;
      isActive?: boolean;
    };
  }>('/:supplyId', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const supply = await fastify.prisma.emergencySupply.findFirst({
      where: { id: request.params.supplyId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!supply) return reply.code(404).send({ error: 'Supply not found' });

    const { expiresAt, nextInspectionDue, location, notes, status, ...data } = request.body;
    const updateData: any = { ...data };
    if (status) updateData.status = status as any;
    if (location) updateData.location = sanitizeText(location);
    if (notes) updateData.notes = sanitizeText(notes);
    if (expiresAt) updateData.expiresAt = new Date(expiresAt);
    if (nextInspectionDue) updateData.nextInspectionDue = new Date(nextInspectionDue);

    return fastify.prisma.emergencySupply.update({ where: { id: supply.id }, data: updateData });
  });

  // ── Supply items CRUD ─────────────────────────────────────────────────
  fastify.post<{
    Params: { supplyId: string };
    Body: { name: string; quantity?: number; minQuantity?: number; expiresAt?: string; lotNumber?: string };
  }>('/:supplyId/items', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const supply = await fastify.prisma.emergencySupply.findFirst({
      where: { id: request.params.supplyId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!supply) return reply.code(404).send({ error: 'Supply not found' });

    const { name, quantity, minQuantity, expiresAt, lotNumber } = request.body;
    const item = await fastify.prisma.supplyItem.create({
      data: {
        supplyId: supply.id,
        name: sanitizeText(name),
        quantity: quantity ?? 1,
        minQuantity: minQuantity ?? 1,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        lotNumber: lotNumber || null,
        isLow: (quantity ?? 1) < (minQuantity ?? 1),
        isExpired: expiresAt ? new Date(expiresAt) < new Date() : false,
      },
    });

    return reply.code(201).send(item);
  });

  fastify.patch<{
    Params: { supplyId: string; itemId: string };
    Body: { quantity?: number; expiresAt?: string; isLow?: boolean; isExpired?: boolean };
  }>('/:supplyId/items/:itemId', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const item = await fastify.prisma.supplyItem.findFirst({
      where: { id: request.params.itemId, supplyId: request.params.supplyId },
    });
    if (!item) return reply.code(404).send({ error: 'Item not found' });

    const { expiresAt, ...data } = request.body;
    const updateData: any = { ...data, lastCheckedAt: new Date() };
    if (expiresAt) updateData.expiresAt = new Date(expiresAt);

    return fastify.prisma.supplyItem.update({ where: { id: item.id }, data: updateData });
  });

  // ── Record inspection ─────────────────────────────────────────────────
  fastify.post<{
    Params: { supplyId: string };
    Body: { status: string; findings?: string; photoUrls?: string[]; itemsChecked?: Record<string, unknown>; nextDueAt?: string };
  }>('/:supplyId/inspections', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const supply = await fastify.prisma.emergencySupply.findFirst({
      where: { id: request.params.supplyId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!supply) return reply.code(404).send({ error: 'Supply not found' });

    const { status, findings, photoUrls, itemsChecked, nextDueAt } = request.body;

    const inspection = await fastify.prisma.supplyInspection.create({
      data: {
        siteId: supply.siteId,
        supplyId: supply.id,
        inspectorId: request.jwtUser.id,
        status,
        findings: findings ? sanitizeText(findings) : null,
        photoUrls: photoUrls || [],
        itemsChecked: itemsChecked || null,
        nextDueAt: nextDueAt ? new Date(nextDueAt) : null,
      },
    });

    // Update supply with last/next inspection dates
    await fastify.prisma.emergencySupply.update({
      where: { id: supply.id },
      data: {
        lastInspectedAt: new Date(),
        lastInspectedBy: request.jwtUser.id,
        nextInspectionDue: nextDueAt ? new Date(nextDueAt) : undefined,
        status: status === 'FAIL' ? 'NEEDS_REPLACEMENT' as any : status === 'NEEDS_ATTENTION' ? 'NEEDS_INSPECTION' as any : 'OPERATIONAL' as any,
      },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: supply.siteId,
        userId: request.jwtUser.id,
        action: 'SUPPLY_INSPECTED',
        entity: 'SupplyInspection',
        entityId: inspection.id,
        details: { supplyId: supply.id, status },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(inspection);
  });

  // ── Record usage ──────────────────────────────────────────────────────
  fastify.post<{
    Params: { supplyId: string };
    Body: { reason: string; description?: string; incidentId?: string; itemsUsed?: unknown[] };
  }>('/:supplyId/usage', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const supply = await fastify.prisma.emergencySupply.findFirst({
      where: { id: request.params.supplyId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!supply) return reply.code(404).send({ error: 'Supply not found' });

    const { reason, description, incidentId, itemsUsed } = request.body;

    const log = await fastify.prisma.supplyUsageLog.create({
      data: {
        siteId: supply.siteId,
        supplyId: supply.id,
        usedById: request.jwtUser.id,
        reason,
        description: description ? sanitizeText(description) : null,
        incidentId: incidentId || null,
        itemsUsed: itemsUsed || null,
      },
    });

    await fastify.prisma.emergencySupply.update({
      where: { id: supply.id },
      data: { status: 'DEPLOYED' as any },
    });

    return reply.code(201).send(log);
  });

  // ── Dashboard: expiring, overdue inspections, low stock ───────────────
  fastify.get<{
    Querystring: { siteId: string };
  }>('/dashboard', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId } = request.query;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const now = new Date();
    const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const [totalSupplies, expiringSoon, expired, overdueInspections, lowStockItems, byType] = await Promise.all([
      fastify.prisma.emergencySupply.count({ where: { siteId, isActive: true } }),
      fastify.prisma.emergencySupply.count({ where: { siteId, isActive: true, expiresAt: { lte: thirtyDays, gt: now } } }),
      fastify.prisma.emergencySupply.count({ where: { siteId, isActive: true, expiresAt: { lte: now } } }),
      fastify.prisma.emergencySupply.count({ where: { siteId, isActive: true, nextInspectionDue: { lte: now } } }),
      fastify.prisma.supplyItem.count({ where: { supply: { siteId }, isLow: true } }),
      fastify.prisma.emergencySupply.groupBy({ by: ['type'], where: { siteId, isActive: true }, _count: true }),
    ]);

    return {
      totalSupplies,
      expiringSoon,
      expired,
      overdueInspections,
      lowStockItems,
      byType: byType.map((t) => ({ type: t.type, count: t._count })),
    };
  });
};

export default emergencySupplyRoutes;
