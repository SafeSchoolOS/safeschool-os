import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OnboardingBuilding {
  name: string;
  floors: number;
  rooms: OnboardingRoom[];
  doors: OnboardingDoor[];
}

interface OnboardingRoom {
  name: string;
  number: string;
  floor: number;
  type: string; // CLASSROOM | OFFICE | GYM | CAFETERIA | LIBRARY | HALLWAY | RESTROOM | OTHER
}

interface OnboardingDoor {
  name: string;
  type: string; // MAIN_ENTRANCE | CLASSROOM | EMERGENCY_EXIT | INTERNAL
  floor: number;
  isExterior: boolean;
  isEmergencyExit: boolean;
  roomName?: string; // optional association by room name
}

interface OnboardingUser {
  name: string;
  email: string;
  role: string; // SITE_ADMIN | OPERATOR | TEACHER | FIRST_RESPONDER
}

interface OnboardingIntegrations {
  accessControl: string;
  dispatch: string;
  notification: string;
}

interface OnboardingPayload {
  site: {
    name: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    organizationId?: string;
    schoolType?: string; // Elementary | Middle | High | Other
  };
  buildings: OnboardingBuilding[];
  users: OnboardingUser[];
  integrations: OnboardingIntegrations;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map wizard door "type" to Prisma Door fields */
function mapDoorType(type: string): { isExterior: boolean; isEmergencyExit: boolean } {
  switch (type) {
    case 'MAIN_ENTRANCE':
      return { isExterior: true, isEmergencyExit: false };
    case 'EMERGENCY_EXIT':
      return { isExterior: true, isEmergencyExit: true };
    case 'CLASSROOM':
    case 'INTERNAL':
    default:
      return { isExterior: false, isEmergencyExit: false };
  }
}

/** Map room type to valid Prisma RoomType enum */
function toRoomType(type: string): string {
  const valid = ['CLASSROOM', 'OFFICE', 'GYM', 'CAFETERIA', 'HALLWAY', 'ENTRANCE', 'OTHER'];
  // LIBRARY and RESTROOM are not in the Prisma enum, map them to OTHER
  if (valid.includes(type)) return type;
  return 'OTHER';
}

/** Map user role to valid Prisma UserRole enum */
function toUserRole(role: string): string {
  const valid = ['SUPER_ADMIN', 'SITE_ADMIN', 'OPERATOR', 'TEACHER', 'FIRST_RESPONDER', 'PARENT'];
  if (valid.includes(role)) return role;
  return 'TEACHER';
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

const onboardingRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /api/v1/onboarding/setup
   *
   * Accepts the full onboarding wizard payload and creates:
   *   Site -> Buildings -> Rooms + Doors -> Users (with UserSite join)
   *
   * Everything runs inside a single Prisma transaction so it either fully
   * succeeds or fully rolls back.
   *
   * Requires SUPER_ADMIN role.
   */
  fastify.post(
    '/setup',
    { preHandler: [fastify.authenticate, requireMinRole('SUPER_ADMIN')] },
    async (request, reply) => {
      const body = request.body as OnboardingPayload;

      // --- Basic validation ---------------------------------------------------
      if (!body.site?.name || !body.site?.address || !body.site?.city || !body.site?.state || !body.site?.zip) {
        return reply.code(400).send({ error: 'Missing required site fields: name, address, city, state, zip' });
      }
      if (!body.buildings || body.buildings.length === 0) {
        return reply.code(400).send({ error: 'At least one building is required' });
      }

      // --- Run everything in a transaction ------------------------------------
      const result = await fastify.prisma.$transaction(async (tx) => {
        // 1. Create Site
        const site = await tx.site.create({
          data: {
            name: sanitizeText(body.site.name),
            address: sanitizeText(body.site.address),
            city: sanitizeText(body.site.city),
            state: sanitizeText(body.site.state),
            zip: sanitizeText(body.site.zip),
            district: sanitizeText(body.site.name), // default district to site name
            latitude: 0,
            longitude: 0,
            organizationId: body.site.organizationId || null,
          },
        });

        // 2. Create Buildings, Rooms, Doors
        const createdBuildings = [];
        for (const bldg of body.buildings) {
          const building = await tx.building.create({
            data: {
              siteId: site.id,
              name: sanitizeText(bldg.name),
              floors: bldg.floors || 1,
            },
          });

          // Rooms
          const createdRooms = [];
          if (bldg.rooms && bldg.rooms.length > 0) {
            for (const room of bldg.rooms) {
              const created = await tx.room.create({
                data: {
                  buildingId: building.id,
                  name: sanitizeText(room.name),
                  number: sanitizeText(room.number),
                  floor: room.floor || 1,
                  type: toRoomType(room.type) as any,
                },
              });
              createdRooms.push(created);
            }
          }

          // Doors
          const createdDoors = [];
          if (bldg.doors && bldg.doors.length > 0) {
            for (const door of bldg.doors) {
              const doorFlags = mapDoorType(door.type);
              const created = await tx.door.create({
                data: {
                  siteId: site.id,
                  buildingId: building.id,
                  name: sanitizeText(door.name),
                  floor: door.floor || 1,
                  isExterior: door.isExterior ?? doorFlags.isExterior,
                  isEmergencyExit: door.isEmergencyExit ?? doorFlags.isEmergencyExit,
                },
              });
              createdDoors.push(created);
            }
          }

          createdBuildings.push({
            ...building,
            rooms: createdRooms,
            doors: createdDoors,
          });
        }

        // 3. Create Users and associate with Site
        const createdUsers = [];
        if (body.users && body.users.length > 0) {
          for (const usr of body.users) {
            if (!usr.email || !usr.name) continue;

            // Check if user already exists
            let user = await tx.user.findUnique({
              where: { email: usr.email.toLowerCase().trim() },
            });

            if (!user) {
              user = await tx.user.create({
                data: {
                  name: sanitizeText(usr.name),
                  email: usr.email.toLowerCase().trim(),
                  role: toUserRole(usr.role) as any,
                },
              });
            }

            // Associate user with site (upsert to avoid duplicates)
            await tx.userSite.upsert({
              where: {
                userId_siteId: {
                  userId: user.id,
                  siteId: site.id,
                },
              },
              create: {
                userId: user.id,
                siteId: site.id,
              },
              update: {},
            });

            createdUsers.push(user);
          }
        }

        // 4. Also associate the requesting user with this site
        await tx.userSite.upsert({
          where: {
            userId_siteId: {
              userId: request.jwtUser.id,
              siteId: site.id,
            },
          },
          create: {
            userId: request.jwtUser.id,
            siteId: site.id,
          },
          update: {},
        });

        // 5. Create audit log entry
        await tx.auditLog.create({
          data: {
            siteId: site.id,
            userId: request.jwtUser.id,
            action: 'SITE_ONBOARDING',
            entity: 'Site',
            entityId: site.id,
            details: JSON.parse(JSON.stringify({
              schoolType: body.site.schoolType || 'Other',
              buildingCount: body.buildings.length,
              roomCount: body.buildings.reduce((sum: number, b: any) => sum + (b.rooms?.length || 0), 0),
              doorCount: body.buildings.reduce((sum: number, b: any) => sum + (b.doors?.length || 0), 0),
              userCount: body.users?.length || 0,
              integrations: body.integrations || {},
            })),
            ipAddress: request.ip,
          },
        });

        return {
          site: {
            ...site,
            buildings: createdBuildings,
          },
          users: createdUsers,
          integrations: body.integrations || {},
        };
      });

      return reply.code(201).send(result);
    }
  );
};

export default onboardingRoutes;
