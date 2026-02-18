import type { PrismaClient } from '@safeschool/db';
import type { VisitorScreeningAdapter, ScreeningAdapterResult } from './index.js';

export class VisitorService {
  private prisma: PrismaClient;
  private screeningAdapter: VisitorScreeningAdapter;

  constructor(prisma: PrismaClient, screeningAdapter: VisitorScreeningAdapter) {
    this.prisma = prisma;
    this.screeningAdapter = screeningAdapter;
  }

  async preRegister(data: {
    siteId: string;
    firstName: string;
    lastName: string;
    purpose: string;
    destination: string;
    hostUserId?: string;
    idType?: string;
    idNumberHash?: string;
    photo?: string;
  }) {
    return this.prisma.visitor.create({
      data: {
        ...data,
        status: 'PRE_REGISTERED',
      },
    });
  }

  async checkIn(visitorId: string, ipAddress?: string) {
    const visitor = await this.prisma.visitor.findUnique({ where: { id: visitorId } });
    if (!visitor) throw new Error('Visitor not found');
    if (visitor.status === 'CHECKED_IN') throw new Error('Visitor already checked in');
    if (visitor.status === 'DENIED') throw new Error('Visitor was denied entry');

    // Run screening
    const screeningResult = await this.screeningAdapter.screen({
      firstName: visitor.firstName,
      lastName: visitor.lastName,
      idType: visitor.idType || undefined,
      idNumber: visitor.idNumberHash || undefined,
    });

    // Determine status based on screening
    const isFlagged =
      screeningResult.sexOffenderCheck === 'FLAGGED' ||
      screeningResult.watchlistCheck === 'FLAGGED';
    const isDenied = isFlagged; // Auto-deny on flag

    const newStatus = isDenied ? 'DENIED' : isFlagged ? 'FLAGGED' : 'CHECKED_IN';
    const badgeNumber = newStatus === 'CHECKED_IN'
      ? `V-${Date.now().toString(36).toUpperCase()}`
      : null;

    // Save screening result
    await this.prisma.visitorScreening.upsert({
      where: { visitorId },
      update: {
        sexOffenderCheck: screeningResult.sexOffenderCheck,
        watchlistCheck: screeningResult.watchlistCheck,
        customCheck: screeningResult.customCheck || null,
        checkedAt: screeningResult.checkedAt,
      },
      create: {
        visitorId,
        sexOffenderCheck: screeningResult.sexOffenderCheck,
        watchlistCheck: screeningResult.watchlistCheck,
        customCheck: screeningResult.customCheck || null,
        checkedAt: screeningResult.checkedAt,
      },
    });

    // Update visitor
    const updated = await this.prisma.visitor.update({
      where: { id: visitorId },
      data: {
        status: newStatus,
        checkedInAt: newStatus === 'CHECKED_IN' ? new Date() : undefined,
        badgeNumber,
      },
      include: { screening: true },
    });

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        siteId: visitor.siteId,
        action: newStatus === 'DENIED' ? 'VISITOR_DENIED' : 'VISITOR_CHECKED_IN',
        entity: 'Visitor',
        entityId: visitorId,
        details: { screening: screeningResult as any, badgeNumber },
        ipAddress,
      },
    });

    return updated;
  }

  async checkOut(visitorId: string, ipAddress?: string) {
    const visitor = await this.prisma.visitor.findUnique({ where: { id: visitorId } });
    if (!visitor) throw new Error('Visitor not found');
    if (visitor.status !== 'CHECKED_IN') throw new Error('Visitor is not checked in');

    const updated = await this.prisma.visitor.update({
      where: { id: visitorId },
      data: {
        status: 'CHECKED_OUT',
        checkedOutAt: new Date(),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        siteId: visitor.siteId,
        action: 'VISITOR_CHECKED_OUT',
        entity: 'Visitor',
        entityId: visitorId,
        details: { badgeNumber: visitor.badgeNumber },
        ipAddress,
      },
    });

    return updated;
  }

  async getActiveVisitors(siteId: string) {
    return this.prisma.visitor.findMany({
      where: { siteId, status: 'CHECKED_IN' },
      include: { screening: true, host: true },
      orderBy: { checkedInAt: 'desc' },
    });
  }

  async searchVisitors(siteId: string, query: string) {
    return this.prisma.visitor.findMany({
      where: {
        siteId,
        OR: [
          { firstName: { contains: query, mode: 'insensitive' } },
          { lastName: { contains: query, mode: 'insensitive' } },
          { badgeNumber: { contains: query, mode: 'insensitive' } },
        ],
      },
      include: { screening: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getVisitor(id: string) {
    return this.prisma.visitor.findUnique({
      where: { id },
      include: { screening: true, host: true },
    });
  }
}
