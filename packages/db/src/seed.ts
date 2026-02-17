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
  students: {
    alex: '00000000-0000-4000-a000-000000007001',
    maya: '00000000-0000-4000-a000-000000007002',
  },
  visitors: {
    preregistered: '00000000-0000-4000-a000-000000006001',
  },
  organization: '00000000-0000-4000-a000-000000008001',
  accessZones: {
    allDoors: '00000000-0000-4000-a000-000000009001',
    adminWing: '00000000-0000-4000-a000-000000009002',
    visitorAccess: '00000000-0000-4000-a000-000000009003',
    mechanical: '00000000-0000-4000-a000-000000009004',
  },
  cardholders: {
    emilyStaff: '00000000-0000-4000-a000-00000000a001',
    tonyWorker: '00000000-0000-4000-a000-00000000a002',
  },
  // First Responder Module IDs
  agencies: {
    cranstonPd: '00000000-0000-4000-a000-00000000b001',
    cranstonFd: '00000000-0000-4000-a000-00000000b002',
    cranstonEms: '00000000-0000-4000-a000-00000000b003',
  },
  responderUsers: {
    sgtSmith: '00000000-0000-4000-a000-00000000c001',
    ofrJones: '00000000-0000-4000-a000-00000000c002',
    dispatcherLee: '00000000-0000-4000-a000-00000000c003',
    invBrown: '00000000-0000-4000-a000-00000000c004',
  },
  schoolAgencyLinks: {
    lincolnCpd: '00000000-0000-4000-a000-00000000d001',
    lincolnCfd: '00000000-0000-4000-a000-00000000d002',
  },
  frReunificationSites: {
    communityCenter: '00000000-0000-4000-a000-00000000e001',
    churchParking: '00000000-0000-4000-a000-00000000e002',
  },
  stagingAreas: {
    eastParking: '00000000-0000-4000-a000-00000000f001',
    westField: '00000000-0000-4000-a000-00000000f002',
    northLot: '00000000-0000-4000-a000-00000000f003',
  },
  keyHolders: {
    principal: '00000000-0000-4000-a000-00000000f101',
    headCustodian: '00000000-0000-4000-a000-00000000f102',
    safetyDir: '00000000-0000-4000-a000-00000000f103',
  },
  hazardLocations: {
    scienceLab: '00000000-0000-4000-a000-00000000f201',
    artRoom: '00000000-0000-4000-a000-00000000f202',
    poolChemicals: '00000000-0000-4000-a000-00000000f203',
  },
  gateways: {
    gatewayA: '00000000-0000-4000-a000-00000000f301',
  },
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

  // Main building rooms (with floor plan positions)
  const mainRooms = [
    { id: IDS.rooms.office, name: 'Main Office', number: '100', floor: 1, type: 'OFFICE' as const, capacity: 10, mapX: 40, mapY: 40, mapW: 180, mapH: 90 },
    { id: IDS.rooms.room101, name: 'Room 101', number: '101', floor: 1, type: 'CLASSROOM' as const, capacity: 30, mapX: 240, mapY: 40, mapW: 150, mapH: 90 },
    { id: IDS.rooms.room102, name: 'Room 102', number: '102', floor: 1, type: 'CLASSROOM' as const, capacity: 30, mapX: 410, mapY: 40, mapW: 150, mapH: 90 },
    { id: IDS.rooms.room103, name: 'Room 103', number: '103', floor: 2, type: 'CLASSROOM' as const, capacity: 30, mapX: 240, mapY: 40, mapW: 150, mapH: 90 },
    { id: IDS.rooms.room104, name: 'Room 104', number: '104', floor: 2, type: 'CLASSROOM' as const, capacity: 30, mapX: 410, mapY: 40, mapW: 150, mapH: 90 },
    { id: IDS.rooms.cafeteria, name: 'Cafeteria', number: 'CAF', floor: 1, type: 'CAFETERIA' as const, capacity: 200, mapX: 580, mapY: 40, mapW: 200, mapH: 90 },
    { id: IDS.rooms.gym, name: 'Gymnasium', number: 'GYM', floor: 1, type: 'GYM' as const, capacity: 300, mapX: 580, mapY: 180, mapW: 200, mapH: 60 },
    { id: IDS.rooms.hallwayMain, name: 'Main Hallway', number: 'HALL-1', floor: 1, type: 'HALLWAY' as const, mapX: 40, mapY: 140, mapW: 740, mapH: 30 },
    { id: IDS.rooms.entranceMain, name: 'Main Entrance', number: 'ENT-1', floor: 1, type: 'ENTRANCE' as const, mapX: 40, mapY: 180, mapW: 180, mapH: 60 },
  ];

  for (const room of mainRooms) {
    await prisma.room.upsert({
      where: { id: room.id },
      update: {},
      create: { ...room, buildingId: IDS.buildings.main },
    });
  }

  // Annex rooms (with floor plan positions)
  const annexRooms = [
    { id: IDS.rooms.room201, name: 'Room 201', number: '201', floor: 1, type: 'CLASSROOM' as const, capacity: 25, mapX: 40, mapY: 40, mapW: 150, mapH: 90 },
    { id: IDS.rooms.room202, name: 'Room 202', number: '202', floor: 1, type: 'CLASSROOM' as const, capacity: 25, mapX: 210, mapY: 40, mapW: 150, mapH: 90 },
    { id: IDS.rooms.entranceAnnex, name: 'Annex Entrance', number: 'ENT-A', floor: 1, type: 'ENTRANCE' as const, mapX: 380, mapY: 40, mapW: 120, mapH: 90 },
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

  // Doors (with floor plan positions)
  const doors = [
    { id: IDS.doors.mainEntrance, name: 'Main Entrance', buildingId: IDS.buildings.main, floor: 1, zone: 'entrance', isExterior: true, isEmergencyExit: false, mapX: 130, mapY: 210 },
    { id: IDS.doors.mainExit, name: 'Main Emergency Exit', buildingId: IDS.buildings.main, floor: 1, zone: 'south', isExterior: true, isEmergencyExit: true, mapX: 400, mapY: 240 },
    { id: IDS.doors.office, name: 'Office Door', buildingId: IDS.buildings.main, floor: 1, zone: 'admin', isExterior: false, isEmergencyExit: false, mapX: 130, mapY: 130 },
    { id: IDS.doors.cafeteria, name: 'Cafeteria Door', buildingId: IDS.buildings.main, floor: 1, zone: 'common', isExterior: false, isEmergencyExit: false, mapX: 580, mapY: 130 },
    { id: IDS.doors.gym, name: 'Gym External Door', buildingId: IDS.buildings.main, floor: 1, zone: 'athletics', isExterior: true, isEmergencyExit: true, mapX: 680, mapY: 240 },
    { id: IDS.doors.hallway1, name: 'Hallway Fire Door', buildingId: IDS.buildings.main, floor: 1, zone: 'hallway', isExterior: false, isEmergencyExit: false, mapX: 300, mapY: 155 },
    { id: IDS.doors.annexEntrance, name: 'Annex Entrance', buildingId: IDS.buildings.annex, floor: 1, zone: 'entrance', isExterior: true, isEmergencyExit: false, mapX: 440, mapY: 130 },
    { id: IDS.doors.annexExit, name: 'Annex Emergency Exit', buildingId: IDS.buildings.annex, floor: 1, zone: 'south', isExterior: true, isEmergencyExit: true, mapX: 210, mapY: 130 },
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

  // ---- Students ----
  const studentsData = [
    {
      id: IDS.students.alex,
      firstName: 'Alex',
      lastName: 'Thompson',
      studentNumber: 'STU-2026-001',
      grade: '3',
      dateOfBirth: new Date('2017-03-15'),
      buildingId: IDS.buildings.main,
      roomId: IDS.rooms.room101,
      enrollmentDate: new Date('2023-09-01'),
      medicalNotes: 'Asthma - has inhaler in nurse office',
      allergies: 'Peanuts',
    },
    {
      id: IDS.students.maya,
      firstName: 'Maya',
      lastName: 'Patel',
      studentNumber: 'STU-2026-002',
      grade: '4',
      dateOfBirth: new Date('2016-07-22'),
      buildingId: IDS.buildings.main,
      roomId: IDS.rooms.room102,
      enrollmentDate: new Date('2022-09-01'),
    },
  ];

  for (const stu of studentsData) {
    await prisma.student.upsert({
      where: { id: stu.id },
      update: {},
      create: { ...stu, siteId: IDS.site, isActive: true },
    });
  }

  // Link existing student cards to students
  await prisma.studentCard.update({
    where: { id: IDS.studentCards.student1 },
    data: { studentId: IDS.students.alex },
  });
  await prisma.studentCard.update({
    where: { id: IDS.studentCards.student2 },
    data: { studentId: IDS.students.maya },
  });

  // Link existing parent contacts to students
  await prisma.parentContact.update({
    where: { id: IDS.parentContacts.parent1 },
    data: { studentId: IDS.students.alex },
  });
  await prisma.parentContact.update({
    where: { id: IDS.parentContacts.parent2 },
    data: { studentId: IDS.students.maya },
  });

  console.log(`  Students: ${studentsData.length} (linked to transport cards and parent contacts)`);

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

  // ---- Access Zones ----

  const accessZones = [
    { id: IDS.accessZones.allDoors, name: 'All Doors', description: 'Full building access — all doors', type: 'PUBLIC' as const },
    { id: IDS.accessZones.adminWing, name: 'Admin Wing', description: 'Administrative offices and front desk', type: 'ADMINISTRATIVE' as const, requiresApproval: true },
    { id: IDS.accessZones.visitorAccess, name: 'Visitor Access', description: 'Main entrance and common areas only', type: 'PUBLIC' as const },
    { id: IDS.accessZones.mechanical, name: 'Mechanical Rooms', description: 'HVAC, electrical, and maintenance areas', type: 'UTILITY' as const, isRestrictedArea: true, requiresApproval: true, accessSchedule: [{ days: [1,2,3,4,5], startTime: '07:00', endTime: '17:00' }] },
  ];

  for (const zone of accessZones) {
    await prisma.accessZone.upsert({
      where: { id: zone.id },
      update: {},
      create: { ...zone, siteId: IDS.site },
    });
  }
  console.log(`  Access zones: ${accessZones.length}`);

  // Door-zone assignments
  const doorZoneAssignments = [
    // All Doors zone gets every non-emergency door
    { doorId: IDS.doors.mainEntrance, zoneId: IDS.accessZones.allDoors },
    { doorId: IDS.doors.office, zoneId: IDS.accessZones.allDoors },
    { doorId: IDS.doors.cafeteria, zoneId: IDS.accessZones.allDoors },
    { doorId: IDS.doors.hallway1, zoneId: IDS.accessZones.allDoors },
    { doorId: IDS.doors.annexEntrance, zoneId: IDS.accessZones.allDoors },
    // Admin Wing
    { doorId: IDS.doors.office, zoneId: IDS.accessZones.adminWing },
    { doorId: IDS.doors.mainEntrance, zoneId: IDS.accessZones.adminWing },
    // Visitor Access (main entrance + cafeteria only)
    { doorId: IDS.doors.mainEntrance, zoneId: IDS.accessZones.visitorAccess },
    { doorId: IDS.doors.cafeteria, zoneId: IDS.accessZones.visitorAccess },
    // Mechanical (hallway fire door)
    { doorId: IDS.doors.hallway1, zoneId: IDS.accessZones.mechanical },
  ];

  for (const dza of doorZoneAssignments) {
    await prisma.doorZoneAssignment.upsert({
      where: { doorId_zoneId: { doorId: dza.doorId, zoneId: dza.zoneId } },
      update: {},
      create: dza,
    });
  }
  console.log(`  Door-zone assignments: ${doorZoneAssignments.length}`);

  // ---- Cardholders ----

  await prisma.cardholder.upsert({
    where: { id: IDS.cardholders.emilyStaff },
    update: {},
    create: {
      id: IDS.cardholders.emilyStaff,
      siteId: IDS.site,
      personType: 'STAFF',
      firstName: 'Emily',
      lastName: 'Chen',
      email: 'teacher1@lincoln.edu',
      phone: '+15551000003',
      title: 'Teacher',
      userId: IDS.users.teacher1,
    },
  });

  await prisma.cardholder.upsert({
    where: { id: IDS.cardholders.tonyWorker },
    update: {},
    create: {
      id: IDS.cardholders.tonyWorker,
      siteId: IDS.site,
      personType: 'WORKER',
      firstName: 'Tony',
      lastName: 'Martinez',
      company: 'Metro HVAC Services',
      title: 'HVAC Technician',
      phone: '+15559002001',
    },
  });
  console.log('  Cardholders: 2 (1 staff, 1 worker)');

  // ============================================================================
  // First Responder Module Seed Data
  // ============================================================================

  console.log('\n🚔 Seeding First Responder Module...');

  // Agencies
  await prisma.agency.upsert({
    where: { id: IDS.agencies.cranstonPd },
    update: {},
    create: {
      id: IDS.agencies.cranstonPd,
      name: 'Cranston Police Department',
      type: 'POLICE',
      jurisdiction: 'Cranston, NJ',
      primaryContact: 'Chief Robert Williams',
      primaryPhone: '+18005551001',
      primaryEmail: 'chief@cranstonpd.gov',
      dispatchPhone: '+18005551000',
      psapId: 'PSAP-NJ-0042',
      status: 'ACTIVE_AGENCY',
    },
  });

  await prisma.agency.upsert({
    where: { id: IDS.agencies.cranstonFd },
    update: {},
    create: {
      id: IDS.agencies.cranstonFd,
      name: 'Cranston Fire Department',
      type: 'FIRE',
      jurisdiction: 'Cranston, NJ',
      primaryContact: 'Chief Maria Gonzalez',
      primaryPhone: '+18005552001',
      primaryEmail: 'chief@cranstonfd.gov',
      dispatchPhone: '+18005552000',
      status: 'ACTIVE_AGENCY',
    },
  });

  await prisma.agency.upsert({
    where: { id: IDS.agencies.cranstonEms },
    update: {},
    create: {
      id: IDS.agencies.cranstonEms,
      name: 'Cranston EMS',
      type: 'EMS',
      jurisdiction: 'Cranston, NJ',
      primaryContact: 'Director Karen Mitchell',
      primaryPhone: '+18005553001',
      primaryEmail: 'director@cranstonems.gov',
      dispatchPhone: '+18005553000',
      status: 'PENDING_AGENCY',
    },
  });
  console.log('  Agencies: 3 (PD, FD, EMS)');

  // Responder Users
  await prisma.responderUser.upsert({
    where: { id: IDS.responderUsers.sgtSmith },
    update: {},
    create: {
      id: IDS.responderUsers.sgtSmith,
      agencyId: IDS.agencies.cranstonPd,
      badgeNumber: 'CPD-1247',
      firstName: 'James',
      lastName: 'Smith',
      email: 'sgt.smith@cranstonpd.gov',
      phone: '+18005551101',
      passwordHash: DEV_PASSWORD_HASH,
      role: 'COMMAND',
      permissions: [
        'VIEW_FLOOR_PLANS', 'VIEW_DOOR_STATUS', 'VIEW_CAMERA_FEEDS',
        'CONTROL_DOORS', 'VIEW_VISITOR_LIST', 'VIEW_STUDENT_ACCOUNTABILITY',
        'VIEW_INCIDENT_LOGS', 'EXPORT_DATA', 'COMMUNICATE_STAFF', 'VIEW_TIPS',
      ],
      status: 'ACTIVE_RESPONDER',
    },
  });

  await prisma.responderUser.upsert({
    where: { id: IDS.responderUsers.ofrJones },
    update: {},
    create: {
      id: IDS.responderUsers.ofrJones,
      agencyId: IDS.agencies.cranstonPd,
      badgeNumber: 'CPD-2089',
      firstName: 'Sarah',
      lastName: 'Jones',
      email: 'ofr.jones@cranstonpd.gov',
      phone: '+18005551102',
      passwordHash: DEV_PASSWORD_HASH,
      role: 'PATROL',
      permissions: [
        'VIEW_FLOOR_PLANS', 'VIEW_DOOR_STATUS', 'VIEW_CAMERA_FEEDS',
        'VIEW_VISITOR_LIST', 'VIEW_INCIDENT_LOGS', 'COMMUNICATE_STAFF',
      ],
      status: 'ACTIVE_RESPONDER',
    },
  });

  await prisma.responderUser.upsert({
    where: { id: IDS.responderUsers.dispatcherLee },
    update: {},
    create: {
      id: IDS.responderUsers.dispatcherLee,
      agencyId: IDS.agencies.cranstonPd,
      badgeNumber: 'CPD-D015',
      firstName: 'Kevin',
      lastName: 'Lee',
      email: 'dispatch.lee@cranstonpd.gov',
      phone: '+18005551103',
      passwordHash: DEV_PASSWORD_HASH,
      role: 'DISPATCH_ROLE',
      permissions: [
        'VIEW_FLOOR_PLANS', 'VIEW_DOOR_STATUS', 'VIEW_INCIDENT_LOGS',
      ],
      status: 'ACTIVE_RESPONDER',
    },
  });

  await prisma.responderUser.upsert({
    where: { id: IDS.responderUsers.invBrown },
    update: {},
    create: {
      id: IDS.responderUsers.invBrown,
      agencyId: IDS.agencies.cranstonPd,
      badgeNumber: 'CPD-3301',
      firstName: 'Lisa',
      lastName: 'Brown',
      email: 'inv.brown@cranstonpd.gov',
      phone: '+18005551104',
      passwordHash: DEV_PASSWORD_HASH,
      role: 'INVESTIGATOR',
      permissions: [
        'VIEW_FLOOR_PLANS', 'VIEW_DOOR_STATUS', 'VIEW_CAMERA_FEEDS',
        'VIEW_INCIDENT_LOGS', 'EXPORT_DATA', 'VIEW_TIPS',
      ],
      status: 'ACTIVE_RESPONDER',
    },
  });
  console.log('  Responder Users: 4 (COMMAND, PATROL, DISPATCH, INVESTIGATOR)');

  // School-Agency Links
  await prisma.schoolAgencyLink.upsert({
    where: { id: IDS.schoolAgencyLinks.lincolnCpd },
    update: {},
    create: {
      id: IDS.schoolAgencyLinks.lincolnCpd,
      siteId: IDS.site,
      agencyId: IDS.agencies.cranstonPd,
      accessLevel: 'FULL_RESPONSE',
      approvedBy: IDS.users.admin,
      approvedAt: new Date(),
      mouSigned: true,
      status: 'ACTIVE_LINK',
    },
  });

  await prisma.schoolAgencyLink.upsert({
    where: { id: IDS.schoolAgencyLinks.lincolnCfd },
    update: {},
    create: {
      id: IDS.schoolAgencyLinks.lincolnCfd,
      siteId: IDS.site,
      agencyId: IDS.agencies.cranstonFd,
      accessLevel: 'PRE_INCIDENT',
      approvedBy: IDS.users.admin,
      approvedAt: new Date(),
      mouSigned: true,
      status: 'ACTIVE_LINK',
    },
  });
  console.log('  School-Agency Links: 2 (PD=FULL_RESPONSE, FD=PRE_INCIDENT)');

  // Reunification Sites
  await prisma.fRReunificationSite.upsert({
    where: { id: IDS.frReunificationSites.communityCenter },
    update: {},
    create: {
      id: IDS.frReunificationSites.communityCenter,
      siteId: IDS.site,
      name: 'Cranston Community Center',
      address: '250 Central Ave, Cranston, NJ 07016',
      isPrimary: true,
      capacity: 500,
      distanceFromSchool: '0.3 miles',
      drivingDirections: 'Exit school east onto Main St, right on Central Ave. Building is on the left.',
      contactName: 'Rita Moreno',
      contactPhone: '+18005554001',
      parkingCapacity: 120,
      notes: 'Large multipurpose room on first floor. Wheelchair accessible.',
    },
  });

  await prisma.fRReunificationSite.upsert({
    where: { id: IDS.frReunificationSites.churchParking },
    update: {},
    create: {
      id: IDS.frReunificationSites.churchParking,
      siteId: IDS.site,
      name: 'First Baptist Church - Fellowship Hall',
      address: '180 Oak Street, Cranston, NJ 07016',
      isPrimary: false,
      capacity: 300,
      distanceFromSchool: '0.5 miles',
      drivingDirections: 'Exit school west onto Main St, left on Oak St. Church on the right.',
      contactName: 'Pastor David Kim',
      contactPhone: '+18005554002',
      parkingCapacity: 80,
      notes: 'Backup site. Fellowship hall can be opened on short notice.',
    },
  });
  console.log('  Reunification Sites: 2 (Community Center=primary, Church=backup)');

  // Staging Areas
  for (const area of [
    { id: IDS.stagingAreas.eastParking, name: 'East Parking Lot', type: 'LAW_ENFORCEMENT', description: 'Primary law enforcement staging. Shielded from school windows.', lat: 40.6641, lng: -74.2097 },
    { id: IDS.stagingAreas.westField, name: 'West Athletic Field', type: 'EMS', description: 'EMS staging with helicopter LZ capability. Open field access from Park Rd.', lat: 40.6638, lng: -74.2112 },
    { id: IDS.stagingAreas.northLot, name: 'North Staff Lot', type: 'COMMAND_POST', description: 'Incident Command Post location. Power and network access from portable generator.', lat: 40.6645, lng: -74.2105 },
  ]) {
    await prisma.stagingArea.upsert({
      where: { id: area.id },
      update: {},
      create: { ...area, siteId: IDS.site },
    });
  }
  console.log('  Staging Areas: 3 (LE, EMS, Command Post)');

  // Key Holders
  for (const kh of [
    { id: IDS.keyHolders.principal, name: 'Dr. Margaret Chen', role: 'Principal', phone: '+18005555001', hasKeys: true, hasAccessCard: true, hasAlarmCode: true, priority: 1 },
    { id: IDS.keyHolders.headCustodian, name: 'Frank Rivera', role: 'Head Custodian', phone: '+18005555002', hasKeys: true, hasAccessCard: true, hasAlarmCode: true, priority: 2 },
    { id: IDS.keyHolders.safetyDir, name: 'Tom Bradley', role: 'Safety Director', phone: '+18005555003', hasKeys: true, hasAccessCard: true, hasAlarmCode: false, priority: 3 },
  ]) {
    await prisma.keyHolder.upsert({
      where: { id: kh.id },
      update: {},
      create: { ...kh, siteId: IDS.site },
    });
  }
  console.log('  Key Holders: 3');

  // Hazard Locations
  for (const hz of [
    { id: IDS.hazardLocations.scienceLab, type: 'Chemical storage', locationDescription: 'Room 103 - Science Lab', buildingId: IDS.buildings.main, floor: 1, description: 'Locked chemical cabinet with acids, bases, solvents. MSDS binder on wall.', sdsAvailable: true },
    { id: IDS.hazardLocations.artRoom, type: 'Art supplies', locationDescription: 'Room 104 - Art Room', buildingId: IDS.buildings.main, floor: 1, description: 'Spray paint, turpentine, kiln. Ventilated storage closet.', sdsAvailable: true },
    { id: IDS.hazardLocations.poolChemicals, type: 'Pool chemicals', locationDescription: 'Annex Building - Maintenance Closet', buildingId: IDS.buildings.annex, floor: 1, description: 'Chlorine and pH chemicals in locked cage. No pool on site - chemicals stored for district.', sdsAvailable: false },
  ]) {
    await prisma.hazardLocation.upsert({
      where: { id: hz.id },
      update: {},
      create: { ...hz, siteId: IDS.site },
    });
  }
  console.log('  Hazard Locations: 3');

  // Gateway (single gateway deployment)
  await prisma.gateway.upsert({
    where: { id: IDS.gateways.gatewayA },
    update: {},
    create: {
      id: IDS.gateways.gatewayA,
      siteId: IDS.site,
      name: 'Gateway A - Main Building',
      hostname: 'gw-lincoln-a',
      ipAddress: '192.168.1.100',
      macAddress: 'AA:BB:CC:DD:EE:01',
      hardwareModel: 'Intel NUC 13 Pro',
      firmwareVersion: '1.0.0',
      clusterRole: 'SINGLE',
      clusterMode: 'STANDALONE',
      clusterState: 'SINGLE_GW',
      status: 'ONLINE_GW',
      lastHeartbeatAt: new Date(),
      lastCloudSyncAt: new Date(),
      cpuUsage: 12,
      memoryUsage: 34,
      diskUsage: 22,
      uptimeSeconds: BigInt(86400),
      bleDevicesConnected: 8,
      networkLatencyMs: 15,
      primaryConnection: 'ETHERNET',
      hasBackupCellular: true,
      cellularSignalStrength: 78,
    },
  });
  console.log('  Gateway: 1 (single, STANDALONE)');

  console.log('\n✅ First Responder Module seed complete!');

  console.log('Seed complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

// Export IDs for use in tests and other seed consumers
export { IDS as SEED_IDS };
