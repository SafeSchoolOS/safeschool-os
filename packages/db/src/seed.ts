import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Default dev password for all seed users
const DEV_PASSWORD = 'safeschool123';
const DEV_PASSWORD_HASH = bcrypt.hashSync(DEV_PASSWORD, 10);

// Stable UUIDs for idempotent seeding
const IDS = {
  site: '00000000-0000-4000-a000-000000000001',
  buildings: {
    main: '00000000-0000-4000-a000-000000000010',
    annex: '00000000-0000-4000-a000-000000000011',
  },
  rooms: {
    // Main building rooms
    office: '00000000-0000-4000-a000-000000000100',
    room101: '00000000-0000-4000-a000-000000000101',
    room102: '00000000-0000-4000-a000-000000000102',
    room103: '00000000-0000-4000-a000-000000000103',
    room104: '00000000-0000-4000-a000-000000000104',
    cafeteria: '00000000-0000-4000-a000-000000000105',
    gym: '00000000-0000-4000-a000-000000000106',
    hallwayMain: '00000000-0000-4000-a000-000000000107',
    entranceMain: '00000000-0000-4000-a000-000000000108',
    // Annex rooms
    room201: '00000000-0000-4000-a000-000000000201',
    room202: '00000000-0000-4000-a000-000000000202',
    entranceAnnex: '00000000-0000-4000-a000-000000000203',
  },
  users: {
    owner: '00000000-0000-4000-a000-000000001000',
    admin: '00000000-0000-4000-a000-000000001001',
    operator: '00000000-0000-4000-a000-000000001002',
    teacher1: '00000000-0000-4000-a000-000000001003',
    teacher2: '00000000-0000-4000-a000-000000001004',
    responder: '00000000-0000-4000-a000-000000001005',
  },
  doors: {
    mainEntrance: '00000000-0000-4000-a000-000000002001',
    mainExit: '00000000-0000-4000-a000-000000002002',
    office: '00000000-0000-4000-a000-000000002003',
    cafeteria: '00000000-0000-4000-a000-000000002004',
    gym: '00000000-0000-4000-a000-000000002005',
    hallway1: '00000000-0000-4000-a000-000000002006',
    annexEntrance: '00000000-0000-4000-a000-000000002007',
    annexExit: '00000000-0000-4000-a000-000000002008',
  },
  // Phase 2 IDs
  buses: {
    bus42: '00000000-0000-4000-a000-000000003001',
  },
  busRoutes: {
    am1: '00000000-0000-4000-a000-000000003010',
  },
  busRouteAssignments: {
    bus42am1: '00000000-0000-4000-a000-000000003020',
  },
  busStops: {
    oakSt: '00000000-0000-4000-a000-000000003100',
    mapleDr: '00000000-0000-4000-a000-000000003101',
    school: '00000000-0000-4000-a000-000000003102',
  },
  studentCards: {
    student1: '00000000-0000-4000-a000-000000004001',
    student2: '00000000-0000-4000-a000-000000004002',
  },
  studentStopAssignments: {
    student1oak: '00000000-0000-4000-a000-000000004010',
    student2maple: '00000000-0000-4000-a000-000000004011',
  },
  parentContacts: {
    parent1: '00000000-0000-4000-a000-000000005001',
    parent2: '00000000-0000-4000-a000-000000005002',
  },
  visitors: {
    preregistered: '00000000-0000-4000-a000-000000006001',
  },
  license: '00000000-0000-4000-a000-000000007001',
  organization: '00000000-0000-4000-a000-000000008001',
} as const;

async function main() {
  console.log('🏫 Seeding Lincoln Elementary...');

  // Organization (district)
  const org = await prisma.organization.upsert({
    where: { id: IDS.organization },
    update: {},
    create: {
      id: IDS.organization,
      name: 'Newark Public Schools',
      slug: 'newark-public-schools',
      type: 'DISTRICT',
      address: '765 Broad St',
      city: 'Newark',
      state: 'NJ',
      zip: '07102',
      phone: '+19737333000',
      website: 'https://www.nps.k12.nj.us',
    },
  });
  console.log(`  Organization: ${org.name}`);

  // Site
  const site = await prisma.site.upsert({
    where: { id: IDS.site },
    update: { organizationId: IDS.organization },
    create: {
      id: IDS.site,
      name: 'Lincoln Elementary School',
      district: 'Newark Public Schools',
      organizationId: IDS.organization,
      address: '123 Lincoln Ave',
      city: 'Newark',
      state: 'NJ',
      zip: '07104',
      latitude: 40.7357,
      longitude: -74.1724,
      timezone: 'America/New_York',
    },
  });
  console.log(`  Site: ${site.name}`);

  // Buildings
  const mainBuilding = await prisma.building.upsert({
    where: { id: IDS.buildings.main },
    update: {},
    create: {
      id: IDS.buildings.main,
      siteId: IDS.site,
      name: 'Main Building',
      floors: 2,
    },
  });

  const annexBuilding = await prisma.building.upsert({
    where: { id: IDS.buildings.annex },
    update: {},
    create: {
      id: IDS.buildings.annex,
      siteId: IDS.site,
      name: 'Annex Building',
      floors: 1,
    },
  });
  console.log(`  Buildings: ${mainBuilding.name}, ${annexBuilding.name}`);

  // Main building rooms
  const mainRooms = [
    { id: IDS.rooms.office, name: 'Main Office', number: '100', floor: 1, type: 'OFFICE' as const, capacity: 10 },
    { id: IDS.rooms.room101, name: 'Room 101', number: '101', floor: 1, type: 'CLASSROOM' as const, capacity: 30 },
    { id: IDS.rooms.room102, name: 'Room 102', number: '102', floor: 1, type: 'CLASSROOM' as const, capacity: 30 },
    { id: IDS.rooms.room103, name: 'Room 103', number: '103', floor: 2, type: 'CLASSROOM' as const, capacity: 30 },
    { id: IDS.rooms.room104, name: 'Room 104', number: '104', floor: 2, type: 'CLASSROOM' as const, capacity: 30 },
    { id: IDS.rooms.cafeteria, name: 'Cafeteria', number: 'CAF', floor: 1, type: 'CAFETERIA' as const, capacity: 200 },
    { id: IDS.rooms.gym, name: 'Gymnasium', number: 'GYM', floor: 1, type: 'GYM' as const, capacity: 300 },
    { id: IDS.rooms.hallwayMain, name: 'Main Hallway', number: 'HALL-1', floor: 1, type: 'HALLWAY' as const },
    { id: IDS.rooms.entranceMain, name: 'Main Entrance', number: 'ENT-1', floor: 1, type: 'ENTRANCE' as const },
  ];

  for (const room of mainRooms) {
    await prisma.room.upsert({
      where: { id: room.id },
      update: {},
      create: { ...room, buildingId: IDS.buildings.main },
    });
  }

  // Annex rooms
  const annexRooms = [
    { id: IDS.rooms.room201, name: 'Room 201', number: '201', floor: 1, type: 'CLASSROOM' as const, capacity: 25 },
    { id: IDS.rooms.room202, name: 'Room 202', number: '202', floor: 1, type: 'CLASSROOM' as const, capacity: 25 },
    { id: IDS.rooms.entranceAnnex, name: 'Annex Entrance', number: 'ENT-A', floor: 1, type: 'ENTRANCE' as const },
  ];

  for (const room of annexRooms) {
    await prisma.room.upsert({
      where: { id: room.id },
      update: {},
      create: { ...room, buildingId: IDS.buildings.annex },
    });
  }
  console.log(`  Rooms: ${mainRooms.length + annexRooms.length} total`);

  // Users (all seed users get the same dev password: 'safeschool123')
  const users = [
    { id: IDS.users.owner, email: 'bwattendorf@gmail.com', name: 'Bruce Wattendorf', role: 'SITE_ADMIN' as const, phone: null, passwordHash: DEV_PASSWORD_HASH },
    { id: IDS.users.admin, email: 'admin@lincoln.edu', name: 'Dr. Sarah Mitchell', role: 'SITE_ADMIN' as const, phone: '+15551000001', passwordHash: DEV_PASSWORD_HASH },
    { id: IDS.users.operator, email: 'operator@lincoln.edu', name: 'James Rodriguez', role: 'OPERATOR' as const, phone: '+15551000002', passwordHash: DEV_PASSWORD_HASH },
    { id: IDS.users.teacher1, email: 'teacher1@lincoln.edu', name: 'Emily Chen', role: 'TEACHER' as const, phone: '+15551000003', wearableDeviceId: 'CX-BADGE-001', passwordHash: DEV_PASSWORD_HASH },
    { id: IDS.users.teacher2, email: 'teacher2@lincoln.edu', name: 'Michael Johnson', role: 'TEACHER' as const, phone: '+15551000004', wearableDeviceId: 'CX-BADGE-002', passwordHash: DEV_PASSWORD_HASH },
    { id: IDS.users.responder, email: 'responder@lincoln.edu', name: 'Officer David Park', role: 'FIRST_RESPONDER' as const, phone: '+15551000005', passwordHash: DEV_PASSWORD_HASH },
  ];

  for (const user of users) {
    await prisma.user.upsert({
      where: { id: user.id },
      update: {},
      create: {
        ...user,
        sites: {
          connectOrCreate: {
            where: { userId_siteId: { userId: user.id, siteId: IDS.site } },
            create: { siteId: IDS.site },
          },
        },
      },
    });
  }
  console.log(`  Users: ${users.length} (${users.map(u => u.role).join(', ')})`);

  // Doors
  const doors = [
    { id: IDS.doors.mainEntrance, name: 'Main Entrance', buildingId: IDS.buildings.main, floor: 1, zone: 'entrance', isExterior: true, isEmergencyExit: false },
    { id: IDS.doors.mainExit, name: 'Main Emergency Exit', buildingId: IDS.buildings.main, floor: 1, zone: 'south', isExterior: true, isEmergencyExit: true },
    { id: IDS.doors.office, name: 'Office Door', buildingId: IDS.buildings.main, floor: 1, zone: 'admin', isExterior: false, isEmergencyExit: false },
    { id: IDS.doors.cafeteria, name: 'Cafeteria Door', buildingId: IDS.buildings.main, floor: 1, zone: 'common', isExterior: false, isEmergencyExit: false },
    { id: IDS.doors.gym, name: 'Gym External Door', buildingId: IDS.buildings.main, floor: 1, zone: 'athletics', isExterior: true, isEmergencyExit: true },
    { id: IDS.doors.hallway1, name: 'Hallway Fire Door', buildingId: IDS.buildings.main, floor: 1, zone: 'hallway', isExterior: false, isEmergencyExit: false },
    { id: IDS.doors.annexEntrance, name: 'Annex Entrance', buildingId: IDS.buildings.annex, floor: 1, zone: 'entrance', isExterior: true, isEmergencyExit: false },
    { id: IDS.doors.annexExit, name: 'Annex Emergency Exit', buildingId: IDS.buildings.annex, floor: 1, zone: 'south', isExterior: true, isEmergencyExit: true },
  ];

  for (const door of doors) {
    await prisma.door.upsert({
      where: { id: door.id },
      update: {},
      create: {
        ...door,
        siteId: IDS.site,
        status: 'LOCKED',
        controllerType: 'mock',
        controllerId: `mock-${door.id.slice(-4)}`,
      },
    });
  }
  console.log(`  Doors: ${doors.length}`);

  // ---- Phase 2: Transportation ----

  const bus42 = await prisma.bus.upsert({
    where: { id: IDS.buses.bus42 },
    update: {},
    create: {
      id: IDS.buses.bus42,
      siteId: IDS.site,
      busNumber: '42',
      driverId: IDS.users.responder,
      capacity: 72,
      hasRfidReader: true,
      hasPanicButton: true,
      hasCameras: true,
      isActive: true,
    },
  });
  console.log(`  Bus: #${bus42.busNumber}`);

  const routeAm1 = await prisma.busRoute.upsert({
    where: { id: IDS.busRoutes.am1 },
    update: {},
    create: {
      id: IDS.busRoutes.am1,
      siteId: IDS.site,
      name: 'Morning Route 1 - North',
      routeNumber: 'AM-1',
      scheduledDepartureTime: '07:00',
      scheduledArrivalTime: '07:45',
      isAmRoute: true,
      isPmRoute: false,
    },
  });

  await prisma.busRouteAssignment.upsert({
    where: { id: IDS.busRouteAssignments.bus42am1 },
    update: {},
    create: {
      id: IDS.busRouteAssignments.bus42am1,
      busId: IDS.buses.bus42,
      routeId: IDS.busRoutes.am1,
    },
  });

  const stops = [
    { id: IDS.busStops.oakSt, name: 'Oak Street & 5th Ave', address: '100 Oak St, Newark, NJ 07104', latitude: 40.7400, longitude: -74.1700, scheduledTime: '07:05', stopOrder: 1 },
    { id: IDS.busStops.mapleDr, name: 'Maple Drive & Park Blvd', address: '200 Maple Dr, Newark, NJ 07104', latitude: 40.7380, longitude: -74.1710, scheduledTime: '07:15', stopOrder: 2 },
    { id: IDS.busStops.school, name: 'Lincoln Elementary (Arrival)', address: '123 Lincoln Ave, Newark, NJ 07104', latitude: 40.7357, longitude: -74.1724, scheduledTime: '07:45', stopOrder: 3 },
  ];

  for (const stop of stops) {
    await prisma.busStop.upsert({
      where: { id: stop.id },
      update: {},
      create: { ...stop, routeId: IDS.busRoutes.am1 },
    });
  }
  console.log(`  Route: ${routeAm1.name} (${stops.length} stops)`);

  // Student cards
  const studentCards = [
    { id: IDS.studentCards.student1, studentName: 'Alex Thompson', cardId: 'RFID-001-2026', grade: '3' },
    { id: IDS.studentCards.student2, studentName: 'Maya Patel', cardId: 'RFID-002-2026', grade: '4' },
  ];

  for (const card of studentCards) {
    await prisma.studentCard.upsert({
      where: { id: card.id },
      update: {},
      create: { ...card, siteId: IDS.site, isActive: true },
    });
  }

  // Student stop assignments
  await prisma.studentStopAssignment.upsert({
    where: { id: IDS.studentStopAssignments.student1oak },
    update: {},
    create: { id: IDS.studentStopAssignments.student1oak, studentCardId: IDS.studentCards.student1, stopId: IDS.busStops.oakSt },
  });
  await prisma.studentStopAssignment.upsert({
    where: { id: IDS.studentStopAssignments.student2maple },
    update: {},
    create: { id: IDS.studentStopAssignments.student2maple, studentCardId: IDS.studentCards.student2, stopId: IDS.busStops.mapleDr },
  });

  console.log(`  Students: ${studentCards.length} cards`);

  // Parent contacts
  const parentContacts = [
    { id: IDS.parentContacts.parent1, studentCardId: IDS.studentCards.student1, parentName: 'Jennifer Thompson', relationship: 'MOTHER', phone: '+15559001001', email: 'jthompson@example.com' },
    { id: IDS.parentContacts.parent2, studentCardId: IDS.studentCards.student2, parentName: 'Raj Patel', relationship: 'FATHER', phone: '+15559001002', email: 'rpatel@example.com' },
  ];

  for (const parent of parentContacts) {
    await prisma.parentContact.upsert({
      where: { id: parent.id },
      update: {},
      create: parent,
    });
  }
  console.log(`  Parent contacts: ${parentContacts.length}`);

  // ---- Phase 2: Visitor ----

  await prisma.visitor.upsert({
    where: { id: IDS.visitors.preregistered },
    update: {},
    create: {
      id: IDS.visitors.preregistered,
      siteId: IDS.site,
      firstName: 'Robert',
      lastName: 'Wilson',
      purpose: 'Parent-teacher conference',
      destination: 'Room 101',
      hostUserId: IDS.users.teacher1,
      status: 'PRE_REGISTERED',
    },
  });
  console.log('  Visitor: 1 pre-registered');

  // ---- BadgeKiosk License (Enterprise for dev) ----

  await prisma.siteLicense.upsert({
    where: { id: IDS.license },
    update: {},
    create: {
      id: IDS.license,
      siteId: IDS.site,
      badgePrinting: true,
      guardConsole: true,
      maxKiosks: 10,
      licenseKey: 'DEV-ENTERPRISE-2026',
    },
  });
  console.log('  BadgeKiosk: Enterprise license (dev)');

  console.log('✅ Seed complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

// Export IDs for use in tests and other seed consumers
export { IDS as SEED_IDS };
