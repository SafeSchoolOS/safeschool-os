import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';

const parentRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/parent/dashboard — Combined parent dashboard data
  fastify.get(
    '/dashboard',
    { preHandler: [fastify.authenticate, requireMinRole('PARENT')] },
    async (request, reply) => {
      const { email, siteIds } = request.jwtUser;
      const siteId = siteIds[0];
      if (!siteId) {
        return reply.code(403).send({ error: 'No site access' });
      }

      // Find children: StudentCards linked to this parent via ParentContact email match
      const parentContacts = await fastify.prisma.parentContact.findMany({
        where: { email },
        include: {
          studentCard: {
            include: {
              stopAssignments: {
                include: {
                  stop: {
                    include: {
                      route: {
                        include: {
                          busAssignments: {
                            include: { bus: true },
                          },
                        },
                      },
                    },
                  },
                },
              },
              ridershipEvents: {
                orderBy: { scannedAt: 'desc' },
                take: 1,
                include: { bus: true },
              },
            },
          },
        },
      });

      // Build children data with bus info (only for contacts linked to a transport card)
      const children = parentContacts.filter((pc) => pc.studentCard).map((pc) => {
        const sc = pc.studentCard!;
        const latestEvent = sc.ridershipEvents[0] || null;
        // Get the bus number from the route assignment or from the latest ridership event
        const routeAssignment = sc.stopAssignments[0]?.stop?.route;
        const assignedBus = routeAssignment?.busAssignments[0]?.bus || null;

        return {
          id: sc.id,
          studentName: sc.studentName,
          cardId: sc.cardId,
          grade: sc.grade,
          busNumber: assignedBus?.busNumber || null,
          busId: assignedBus?.id || null,
          routeName: routeAssignment?.name || null,
          routeNumber: routeAssignment?.routeNumber || null,
          latestScan: latestEvent
            ? {
                scanType: latestEvent.scanType,
                scannedAt: latestEvent.scannedAt,
                busNumber: latestEvent.bus.busNumber,
              }
            : null,
          status: latestEvent?.scanType === 'BOARD' ? 'ON_BUS' : 'OFF_BUS',
          parentContactId: pc.id,
          relationship: pc.relationship,
        };
      });

      // Collect unique bus IDs for bus status
      const busIds = [
        ...new Set(
          children
            .map((c) => c.busId)
            .filter((id): id is string => id !== null)
        ),
      ];

      // Get current bus locations
      const busStatus =
        busIds.length > 0
          ? await fastify.prisma.bus.findMany({
              where: { id: { in: busIds } },
              select: {
                id: true,
                busNumber: true,
                currentLatitude: true,
                currentLongitude: true,
                currentSpeed: true,
                currentHeading: true,
                lastGpsAt: true,
                currentStudentCount: true,
                isActive: true,
              },
            })
          : [];

      // Get active alerts for this site (not resolved/cancelled)
      const activeAlerts = await fastify.prisma.alert.findMany({
        where: {
          siteId,
          status: { notIn: ['RESOLVED', 'CANCELLED'] },
        },
        select: {
          id: true,
          level: true,
          status: true,
          message: true,
          buildingName: true,
          triggeredAt: true,
        },
        orderBy: { triggeredAt: 'desc' },
        take: 5,
      });

      // Check for active lockdown
      const activeLockdown = await fastify.prisma.lockdownCommand.findFirst({
        where: {
          siteId,
          releasedAt: null,
        },
        orderBy: { initiatedAt: 'desc' },
      });

      // Determine school status
      let schoolStatus: 'ALL_CLEAR' | 'LOCKDOWN' | 'ALERT_ACTIVE' = 'ALL_CLEAR';
      if (activeLockdown) {
        schoolStatus = 'LOCKDOWN';
      } else if (activeAlerts.length > 0) {
        schoolStatus = 'ALERT_ACTIVE';
      }

      // Get recent notifications for the site
      const recentNotifications = await fastify.prisma.notificationLog.findMany({
        where: { siteId },
        orderBy: { sentAt: 'desc' },
        take: 20,
        select: {
          id: true,
          channel: true,
          message: true,
          status: true,
          sentAt: true,
        },
      });

      // Get site info for emergency contacts
      const site = await fastify.prisma.site.findUnique({
        where: { id: siteId },
        select: {
          id: true,
          name: true,
          address: true,
          city: true,
          state: true,
          zip: true,
        },
      });

      return {
        children,
        busStatus,
        schoolStatus,
        activeAlerts,
        recentNotifications,
        site,
      };
    },
  );
};

export default parentRoutes;
