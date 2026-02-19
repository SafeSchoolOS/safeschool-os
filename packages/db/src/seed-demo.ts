/**
 * SafeSchool Demo Seed — Multi-School District Demo Environment
 * =============================================================
 *
 * This seeds a comprehensive, realistic multi-school demo for the
 * Newark Public Schools district. Run with: npm run seed:demo
 *
 * DEMO CREDENTIALS (all passwords: safeschool123)
 * ================================================
 *
 * DISTRICT ADMIN:
 *   admin@newark.k12.nj.us    SUPER_ADMIN   (district-wide)
 *
 * LINCOLN ELEMENTARY (K-5):
 *   admin@lincoln.edu          SITE_ADMIN
 *   security1@lincoln.edu      OPERATOR
 *   security2@lincoln.edu      OPERATOR
 *   teacher1@lincoln.edu       TEACHER       (Emily Chen)
 *   teacher2@lincoln.edu       TEACHER       (Michael Johnson)
 *   ... 8 more teachers
 *   responder1@lincoln.edu     FIRST_RESPONDER
 *   parent1@lincoln.edu        PARENT
 *   ... 4 more parents
 *
 * WASHINGTON MIDDLE SCHOOL (6-8):
 *   admin@washington.edu       SITE_ADMIN
 *   security1@washington.edu   OPERATOR
 *   security2@washington.edu   OPERATOR
 *   teacher1@washington.edu    TEACHER
 *   ... 12 more teachers
 *   responder1@washington.edu  FIRST_RESPONDER
 *   parent1@washington.edu     PARENT
 *   ... 6 more parents
 *
 * JEFFERSON HIGH SCHOOL (9-12):
 *   admin@jefferson.edu        SITE_ADMIN
 *   security1@jefferson.edu    OPERATOR
 *   security2@jefferson.edu    OPERATOR
 *   security3@jefferson.edu    OPERATOR
 *   teacher1@jefferson.edu     TEACHER
 *   ... 14 more teachers
 *   responder1@jefferson.edu   FIRST_RESPONDER
 *   responder2@jefferson.edu   FIRST_RESPONDER
 *   parent1@jefferson.edu      PARENT
 *   ... 9 more parents
 *
 * PRE-CONFIGURED DEMO SCENARIOS:
 * ================================
 * 1. ACTIVE LOCKDOWN at Jefferson HS — doors locked, alert TRIGGERED, timeline
 * 2. BUS #42 IN TRANSIT — GPS near Lincoln Elementary, 2 students boarded
 * 3. VISITOR CHECKED IN at Washington MS — screening completed
 * 4. DRILL COMPLIANCE — Lincoln behind on active threat drill requirement
 * 5. ENVIRONMENTAL ALERT — High CO2 in Jefferson HS Room 301
 * 6. ANONYMOUS TIP under review at Washington MS
 * 7. VISITOR BAN — flagged individual banned district-wide
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const DEV_PASSWORD = 'safeschool123';
const DEV_PASSWORD_HASH = bcrypt.hashSync(DEV_PASSWORD, 10);

// ============================================================================
// Stable UUID helpers
// ============================================================================
// a000 = Lincoln, b000 = Washington, c000 = Jefferson, d000 = district-wide

const ID = {
  org: '00000000-0000-4000-a000-000000008001',

  // --- Sites ---
  lincoln:    '00000000-0000-4000-a000-000000000001',
  washington: '00000000-0000-4000-b000-000000000001',
  jefferson:  '00000000-0000-4000-c000-000000000001',

  // --- Lincoln Buildings ---
  linMain:    '00000000-0000-4000-a000-000000000010',
  linAnnex:   '00000000-0000-4000-a000-000000000011',

  // --- Washington Buildings ---
  wasMain:    '00000000-0000-4000-b000-000000000010',
  wasGym:     '00000000-0000-4000-b000-000000000011',
  wasScience: '00000000-0000-4000-b000-000000000012',

  // --- Jefferson Buildings ---
  jefMain:    '00000000-0000-4000-c000-000000000010',
  jefWest:    '00000000-0000-4000-c000-000000000011',
  jefGym:     '00000000-0000-4000-c000-000000000012',
  jefArts:    '00000000-0000-4000-c000-000000000013',
} as const;

// UUID generator with prefix
function uuid(prefix: string, seq: number): string {
  const hex = seq.toString(16).padStart(12, '0');
  return `00000000-0000-4000-${prefix}-${hex}`;
}

// ============================================================================
// Main seed function
// ============================================================================
async function main() {
  console.log('=== SafeSchool Multi-School Demo Seed ===\n');

  // --------------------------------------------------------------------------
  // Organization
  // --------------------------------------------------------------------------
  console.log('1/12  Organization...');
  await prisma.organization.upsert({
    where: { id: ID.org },
    update: {},
    create: {
      id: ID.org,
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

  // --------------------------------------------------------------------------
  // Sites
  // --------------------------------------------------------------------------
  console.log('2/12  Sites...');
  const siteDefs = [
    { id: ID.lincoln,    name: 'Lincoln Elementary School',    address: '123 Lincoln Ave',     city: 'Newark', zip: '07104', lat: 40.7357, lng: -74.1724 },
    { id: ID.washington, name: 'Washington Middle School',     address: '456 Washington Blvd', city: 'Newark', zip: '07106', lat: 40.7282, lng: -74.1912 },
    { id: ID.jefferson,  name: 'Jefferson High School',        address: '789 Jefferson St',    city: 'Newark', zip: '07108', lat: 40.7195, lng: -74.2001 },
  ];
  for (const s of siteDefs) {
    await prisma.site.upsert({
      where: { id: s.id },
      update: { organizationId: ID.org },
      create: {
        id: s.id,
        organizationId: ID.org,
        name: s.name,
        district: 'Newark Public Schools',
        address: s.address,
        city: s.city,
        state: 'NJ',
        zip: s.zip,
        latitude: s.lat,
        longitude: s.lng,
        timezone: 'America/New_York',
      },
    });
  }

  // --------------------------------------------------------------------------
  // Buildings
  // --------------------------------------------------------------------------
  console.log('3/12  Buildings...');
  const buildingDefs = [
    // Lincoln (2)
    { id: ID.linMain,  siteId: ID.lincoln,    name: 'Main Building',      floors: 2 },
    { id: ID.linAnnex, siteId: ID.lincoln,    name: 'Annex Building',     floors: 1 },
    // Washington (3)
    { id: ID.wasMain,    siteId: ID.washington, name: 'Main Building',     floors: 3 },
    { id: ID.wasGym,     siteId: ID.washington, name: 'Gymnasium Complex', floors: 1 },
    { id: ID.wasScience, siteId: ID.washington, name: 'Science Wing',     floors: 2 },
    // Jefferson (4)
    { id: ID.jefMain, siteId: ID.jefferson,  name: 'Main Building',       floors: 3 },
    { id: ID.jefWest, siteId: ID.jefferson,  name: 'West Wing',           floors: 2 },
    { id: ID.jefGym,  siteId: ID.jefferson,  name: 'Athletic Center',     floors: 1 },
    { id: ID.jefArts, siteId: ID.jefferson,  name: 'Performing Arts Center', floors: 2 },
  ];
  for (const b of buildingDefs) {
    await prisma.building.upsert({
      where: { id: b.id },
      update: {},
      create: b,
    });
  }

  // --------------------------------------------------------------------------
  // Rooms
  // --------------------------------------------------------------------------
  console.log('4/12  Rooms...');
  const RT = {
    CL: 'CLASSROOM' as const, OF: 'OFFICE' as const, GY: 'GYM' as const,
    CA: 'CAFETERIA' as const, HL: 'HALLWAY' as const, EN: 'ENTRANCE' as const,
    OT: 'OTHER' as const, ST: 'STORAGE' as const, KI: 'KITCHEN' as const,
  };

  // Lincoln rooms (15)
  const lincolnRooms = [
    { id: uuid('a000', 0x100), bld: ID.linMain,  name: 'Main Office',     num: '100', floor: 1, type: RT.OF, cap: 10 },
    { id: uuid('a000', 0x101), bld: ID.linMain,  name: 'Room 101',        num: '101', floor: 1, type: RT.CL, cap: 28 },
    { id: uuid('a000', 0x102), bld: ID.linMain,  name: 'Room 102',        num: '102', floor: 1, type: RT.CL, cap: 28 },
    { id: uuid('a000', 0x103), bld: ID.linMain,  name: 'Room 103',        num: '103', floor: 1, type: RT.CL, cap: 28 },
    { id: uuid('a000', 0x104), bld: ID.linMain,  name: 'Room 104',        num: '104', floor: 2, type: RT.CL, cap: 28 },
    { id: uuid('a000', 0x105), bld: ID.linMain,  name: 'Cafeteria',       num: 'CAF', floor: 1, type: RT.CA, cap: 200 },
    { id: uuid('a000', 0x106), bld: ID.linMain,  name: 'Gymnasium',       num: 'GYM', floor: 1, type: RT.GY, cap: 300 },
    { id: uuid('a000', 0x107), bld: ID.linMain,  name: 'Main Hallway',    num: 'HALL-1', floor: 1, type: RT.HL },
    { id: uuid('a000', 0x108), bld: ID.linMain,  name: 'Main Entrance',   num: 'ENT-1', floor: 1, type: RT.EN },
    { id: uuid('a000', 0x109), bld: ID.linMain,  name: 'Library',         num: 'LIB', floor: 1, type: RT.OT, cap: 60 },
    { id: uuid('a000', 0x110), bld: ID.linMain,  name: "Nurse's Office",  num: '110', floor: 1, type: RT.OF, cap: 6 },
    { id: uuid('a000', 0x111), bld: ID.linMain,  name: 'Room 201',        num: '201', floor: 2, type: RT.CL, cap: 28 },
    { id: uuid('a000', 0x112), bld: ID.linMain,  name: 'Room 202',        num: '202', floor: 2, type: RT.CL, cap: 28 },
    { id: uuid('a000', 0x201), bld: ID.linAnnex, name: 'Art Room',        num: 'ART', floor: 1, type: RT.CL, cap: 25 },
    { id: uuid('a000', 0x202), bld: ID.linAnnex, name: 'Music Room',      num: 'MUS', floor: 1, type: RT.CL, cap: 30 },
  ];

  // Washington rooms (22)
  const washingtonRooms = [
    { id: uuid('b000', 0x100), bld: ID.wasMain,    name: 'Main Office',      num: '100', floor: 1, type: RT.OF, cap: 15 },
    { id: uuid('b000', 0x101), bld: ID.wasMain,    name: 'Room 101',         num: '101', floor: 1, type: RT.CL, cap: 32 },
    { id: uuid('b000', 0x102), bld: ID.wasMain,    name: 'Room 102',         num: '102', floor: 1, type: RT.CL, cap: 32 },
    { id: uuid('b000', 0x103), bld: ID.wasMain,    name: 'Room 103',         num: '103', floor: 1, type: RT.CL, cap: 32 },
    { id: uuid('b000', 0x104), bld: ID.wasMain,    name: 'Room 104',         num: '104', floor: 1, type: RT.CL, cap: 32 },
    { id: uuid('b000', 0x201), bld: ID.wasMain,    name: 'Room 201',         num: '201', floor: 2, type: RT.CL, cap: 32 },
    { id: uuid('b000', 0x202), bld: ID.wasMain,    name: 'Room 202',         num: '202', floor: 2, type: RT.CL, cap: 32 },
    { id: uuid('b000', 0x203), bld: ID.wasMain,    name: 'Room 203',         num: '203', floor: 2, type: RT.CL, cap: 32 },
    { id: uuid('b000', 0x204), bld: ID.wasMain,    name: 'Room 204',         num: '204', floor: 2, type: RT.CL, cap: 32 },
    { id: uuid('b000', 0x301), bld: ID.wasMain,    name: 'Room 301',         num: '301', floor: 3, type: RT.CL, cap: 32 },
    { id: uuid('b000', 0x302), bld: ID.wasMain,    name: 'Room 302',         num: '302', floor: 3, type: RT.CL, cap: 32 },
    { id: uuid('b000', 0x105), bld: ID.wasMain,    name: 'Cafeteria',        num: 'CAF', floor: 1, type: RT.CA, cap: 350 },
    { id: uuid('b000', 0x106), bld: ID.wasMain,    name: 'Main Entrance',    num: 'ENT-1', floor: 1, type: RT.EN },
    { id: uuid('b000', 0x107), bld: ID.wasMain,    name: 'Library/Media Ctr', num: 'LIB', floor: 1, type: RT.OT, cap: 80 },
    { id: uuid('b000', 0x108), bld: ID.wasMain,    name: "Nurse's Office",   num: 'NRS', floor: 1, type: RT.OF, cap: 8 },
    { id: uuid('b000', 0x109), bld: ID.wasMain,    name: 'Guidance Office',  num: 'GCE', floor: 1, type: RT.OF, cap: 6 },
    { id: uuid('b000', 0x150), bld: ID.wasGym,     name: 'Main Gymnasium',   num: 'GYM-1', floor: 1, type: RT.GY, cap: 500 },
    { id: uuid('b000', 0x151), bld: ID.wasGym,     name: 'Locker Room A',    num: 'LKR-A', floor: 1, type: RT.OT, cap: 40 },
    { id: uuid('b000', 0x152), bld: ID.wasGym,     name: 'Locker Room B',    num: 'LKR-B', floor: 1, type: RT.OT, cap: 40 },
    { id: uuid('b000', 0x160), bld: ID.wasScience, name: 'Science Lab 1',    num: 'SCI-1', floor: 1, type: RT.CL, cap: 28 },
    { id: uuid('b000', 0x161), bld: ID.wasScience, name: 'Science Lab 2',    num: 'SCI-2', floor: 1, type: RT.CL, cap: 28 },
    { id: uuid('b000', 0x162), bld: ID.wasScience, name: 'Computer Lab',     num: 'CMP', floor: 2, type: RT.CL, cap: 30 },
  ];

  // Jefferson rooms (30)
  const jeffersonRooms = [
    { id: uuid('c000', 0x100), bld: ID.jefMain, name: 'Main Office',       num: '100', floor: 1, type: RT.OF, cap: 20 },
    { id: uuid('c000', 0x101), bld: ID.jefMain, name: 'Room 101',          num: '101', floor: 1, type: RT.CL, cap: 35 },
    { id: uuid('c000', 0x102), bld: ID.jefMain, name: 'Room 102',          num: '102', floor: 1, type: RT.CL, cap: 35 },
    { id: uuid('c000', 0x103), bld: ID.jefMain, name: 'Room 103',          num: '103', floor: 1, type: RT.CL, cap: 35 },
    { id: uuid('c000', 0x104), bld: ID.jefMain, name: 'Room 104',          num: '104', floor: 1, type: RT.CL, cap: 35 },
    { id: uuid('c000', 0x105), bld: ID.jefMain, name: 'Cafeteria',         num: 'CAF', floor: 1, type: RT.CA, cap: 500 },
    { id: uuid('c000', 0x106), bld: ID.jefMain, name: 'Main Entrance',     num: 'ENT-1', floor: 1, type: RT.EN },
    { id: uuid('c000', 0x107), bld: ID.jefMain, name: 'Library',           num: 'LIB', floor: 1, type: RT.OT, cap: 120 },
    { id: uuid('c000', 0x108), bld: ID.jefMain, name: "Nurse's Office",    num: 'NRS', floor: 1, type: RT.OF, cap: 10 },
    { id: uuid('c000', 0x201), bld: ID.jefMain, name: 'Room 201',          num: '201', floor: 2, type: RT.CL, cap: 35 },
    { id: uuid('c000', 0x202), bld: ID.jefMain, name: 'Room 202',          num: '202', floor: 2, type: RT.CL, cap: 35 },
    { id: uuid('c000', 0x203), bld: ID.jefMain, name: 'Room 203',          num: '203', floor: 2, type: RT.CL, cap: 35 },
    { id: uuid('c000', 0x204), bld: ID.jefMain, name: 'Room 204',          num: '204', floor: 2, type: RT.CL, cap: 35 },
    { id: uuid('c000', 0x301), bld: ID.jefMain, name: 'Room 301',          num: '301', floor: 3, type: RT.CL, cap: 35 },
    { id: uuid('c000', 0x302), bld: ID.jefMain, name: 'Room 302',          num: '302', floor: 3, type: RT.CL, cap: 35 },
    { id: uuid('c000', 0x303), bld: ID.jefMain, name: 'Room 303',          num: '303', floor: 3, type: RT.CL, cap: 35 },
    // West Wing
    { id: uuid('c000', 0x401), bld: ID.jefWest, name: 'Chemistry Lab',     num: 'CHEM', floor: 1, type: RT.CL, cap: 28 },
    { id: uuid('c000', 0x402), bld: ID.jefWest, name: 'Physics Lab',       num: 'PHY',  floor: 1, type: RT.CL, cap: 28 },
    { id: uuid('c000', 0x403), bld: ID.jefWest, name: 'Biology Lab',       num: 'BIO',  floor: 1, type: RT.CL, cap: 28 },
    { id: uuid('c000', 0x404), bld: ID.jefWest, name: 'Computer Science',  num: 'CS',   floor: 2, type: RT.CL, cap: 30 },
    { id: uuid('c000', 0x405), bld: ID.jefWest, name: 'Engineering Lab',   num: 'ENG',  floor: 2, type: RT.CL, cap: 24 },
    // Athletic Center
    { id: uuid('c000', 0x501), bld: ID.jefGym,  name: 'Main Gymnasium',    num: 'GYM-1', floor: 1, type: RT.GY, cap: 800 },
    { id: uuid('c000', 0x502), bld: ID.jefGym,  name: 'Weight Room',       num: 'WGT',  floor: 1, type: RT.OT, cap: 40 },
    { id: uuid('c000', 0x503), bld: ID.jefGym,  name: 'Pool',              num: 'POOL', floor: 1, type: RT.OT, cap: 60 },
    { id: uuid('c000', 0x504), bld: ID.jefGym,  name: 'Locker Room A',     num: 'LKR-A', floor: 1, type: RT.OT, cap: 50 },
    { id: uuid('c000', 0x505), bld: ID.jefGym,  name: 'Locker Room B',     num: 'LKR-B', floor: 1, type: RT.OT, cap: 50 },
    // Arts
    { id: uuid('c000', 0x601), bld: ID.jefArts, name: 'Auditorium',        num: 'AUD',  floor: 1, type: RT.OT, cap: 600 },
    { id: uuid('c000', 0x602), bld: ID.jefArts, name: 'Band Room',         num: 'BAND', floor: 1, type: RT.CL, cap: 50 },
    { id: uuid('c000', 0x603), bld: ID.jefArts, name: 'Art Studio',        num: 'ART',  floor: 2, type: RT.CL, cap: 30 },
    { id: uuid('c000', 0x604), bld: ID.jefArts, name: 'Drama Studio',      num: 'DRA',  floor: 2, type: RT.CL, cap: 35 },
  ];

  const allRooms = [...lincolnRooms, ...washingtonRooms, ...jeffersonRooms];
  for (const r of allRooms) {
    await prisma.room.upsert({
      where: { id: r.id },
      update: {},
      create: {
        id: r.id,
        buildingId: r.bld,
        name: r.name,
        number: r.num,
        floor: r.floor,
        type: r.type,
        capacity: r.cap ?? null,
      },
    });
  }
  console.log(`       ${allRooms.length} rooms created`);

  // --------------------------------------------------------------------------
  // Users
  // --------------------------------------------------------------------------
  console.log('5/12  Users...');

  type UserDef = {
    id: string;
    email: string;
    name: string;
    role: 'SUPER_ADMIN' | 'SITE_ADMIN' | 'OPERATOR' | 'TEACHER' | 'FIRST_RESPONDER' | 'PARENT';
    phone?: string;
    wearableDeviceId?: string;
    siteIds: string[];
  };

  const users: UserDef[] = [
    // District admin
    { id: uuid('d000', 1), email: 'admin@newark.k12.nj.us', name: 'District Admin', role: 'SUPER_ADMIN', siteIds: [ID.lincoln, ID.washington, ID.jefferson] },

    // ---- Lincoln Elementary ----
    { id: uuid('a000', 0x1001), email: 'admin@lincoln.edu',       name: 'Dr. Sarah Mitchell',    role: 'SITE_ADMIN',       phone: '+15551000001', siteIds: [ID.lincoln] },
    { id: uuid('a000', 0x1002), email: 'security1@lincoln.edu',   name: 'James Rodriguez',       role: 'OPERATOR',         phone: '+15551000002', siteIds: [ID.lincoln] },
    { id: uuid('a000', 0x1003), email: 'security2@lincoln.edu',   name: 'Patricia Holmes',       role: 'OPERATOR',         phone: '+15551000003', siteIds: [ID.lincoln] },
    { id: uuid('a000', 0x1010), email: 'teacher1@lincoln.edu',    name: 'Emily Chen',            role: 'TEACHER',          phone: '+15551000010', wearableDeviceId: 'CX-LIN-001', siteIds: [ID.lincoln] },
    { id: uuid('a000', 0x1011), email: 'teacher2@lincoln.edu',    name: 'Michael Johnson',       role: 'TEACHER',          phone: '+15551000011', wearableDeviceId: 'CX-LIN-002', siteIds: [ID.lincoln] },
    { id: uuid('a000', 0x1012), email: 'teacher3@lincoln.edu',    name: 'Maria Santos',          role: 'TEACHER',          phone: '+15551000012', siteIds: [ID.lincoln] },
    { id: uuid('a000', 0x1013), email: 'teacher4@lincoln.edu',    name: 'Robert Kim',            role: 'TEACHER',          phone: '+15551000013', siteIds: [ID.lincoln] },
    { id: uuid('a000', 0x1014), email: 'teacher5@lincoln.edu',    name: 'Angela Davis',          role: 'TEACHER',          phone: '+15551000014', siteIds: [ID.lincoln] },
    { id: uuid('a000', 0x1015), email: 'teacher6@lincoln.edu',    name: 'Thomas Wright',         role: 'TEACHER',          phone: '+15551000015', siteIds: [ID.lincoln] },
    { id: uuid('a000', 0x1016), email: 'teacher7@lincoln.edu',    name: 'Lisa Park',             role: 'TEACHER',          phone: '+15551000016', siteIds: [ID.lincoln] },
    { id: uuid('a000', 0x1017), email: 'teacher8@lincoln.edu',    name: 'David Hernandez',       role: 'TEACHER',          phone: '+15551000017', siteIds: [ID.lincoln] },
    { id: uuid('a000', 0x1018), email: 'teacher9@lincoln.edu',    name: 'Jennifer White',        role: 'TEACHER',          phone: '+15551000018', siteIds: [ID.lincoln] },
    { id: uuid('a000', 0x1019), email: 'teacher10@lincoln.edu',   name: 'Mark Thompson',         role: 'TEACHER',          phone: '+15551000019', siteIds: [ID.lincoln] },
    { id: uuid('a000', 0x1030), email: 'responder1@lincoln.edu',  name: 'Officer David Park',    role: 'FIRST_RESPONDER',  phone: '+15551000030', siteIds: [ID.lincoln] },
    { id: uuid('a000', 0x1040), email: 'parent1@lincoln.edu',     name: 'Jennifer Thompson',     role: 'PARENT',           phone: '+15551000040', siteIds: [ID.lincoln] },
    { id: uuid('a000', 0x1041), email: 'parent2@lincoln.edu',     name: 'Raj Patel',             role: 'PARENT',           phone: '+15551000041', siteIds: [ID.lincoln] },
    { id: uuid('a000', 0x1042), email: 'parent3@lincoln.edu',     name: 'Carmen Rivera',         role: 'PARENT',           phone: '+15551000042', siteIds: [ID.lincoln] },
    { id: uuid('a000', 0x1043), email: 'parent4@lincoln.edu',     name: 'Wei Zhang',             role: 'PARENT',           phone: '+15551000043', siteIds: [ID.lincoln] },
    { id: uuid('a000', 0x1044), email: 'parent5@lincoln.edu',     name: 'Aisha Johnson',         role: 'PARENT',           phone: '+15551000044', siteIds: [ID.lincoln] },

    // ---- Washington Middle School ----
    { id: uuid('b000', 0x1001), email: 'admin@washington.edu',     name: 'Dr. Marcus Greene',     role: 'SITE_ADMIN',       phone: '+15552000001', siteIds: [ID.washington] },
    { id: uuid('b000', 0x1002), email: 'security1@washington.edu', name: 'Karen Lopez',           role: 'OPERATOR',         phone: '+15552000002', siteIds: [ID.washington] },
    { id: uuid('b000', 0x1003), email: 'security2@washington.edu', name: 'Derek Washington',      role: 'OPERATOR',         phone: '+15552000003', siteIds: [ID.washington] },
    { id: uuid('b000', 0x1010), email: 'teacher1@washington.edu',  name: 'Amanda Foster',         role: 'TEACHER',          phone: '+15552000010', wearableDeviceId: 'CX-WAS-001', siteIds: [ID.washington] },
    { id: uuid('b000', 0x1011), email: 'teacher2@washington.edu',  name: 'Brian Miller',          role: 'TEACHER',          phone: '+15552000011', wearableDeviceId: 'CX-WAS-002', siteIds: [ID.washington] },
    { id: uuid('b000', 0x1012), email: 'teacher3@washington.edu',  name: 'Cynthia Nguyen',        role: 'TEACHER',          phone: '+15552000012', siteIds: [ID.washington] },
    { id: uuid('b000', 0x1013), email: 'teacher4@washington.edu',  name: 'Daniel Scott',          role: 'TEACHER',          phone: '+15552000013', siteIds: [ID.washington] },
    { id: uuid('b000', 0x1014), email: 'teacher5@washington.edu',  name: 'Eleanor Brooks',        role: 'TEACHER',          phone: '+15552000014', siteIds: [ID.washington] },
    { id: uuid('b000', 0x1015), email: 'teacher6@washington.edu',  name: 'Frank Diaz',            role: 'TEACHER',          phone: '+15552000015', siteIds: [ID.washington] },
    { id: uuid('b000', 0x1016), email: 'teacher7@washington.edu',  name: 'Grace Lee',             role: 'TEACHER',          phone: '+15552000016', siteIds: [ID.washington] },
    { id: uuid('b000', 0x1017), email: 'teacher8@washington.edu',  name: 'Howard Jackson',        role: 'TEACHER',          phone: '+15552000017', siteIds: [ID.washington] },
    { id: uuid('b000', 0x1018), email: 'teacher9@washington.edu',  name: 'Irene Costa',           role: 'TEACHER',          phone: '+15552000018', siteIds: [ID.washington] },
    { id: uuid('b000', 0x1019), email: 'teacher10@washington.edu', name: 'Jason Pham',            role: 'TEACHER',          phone: '+15552000019', siteIds: [ID.washington] },
    { id: uuid('b000', 0x101a), email: 'teacher11@washington.edu', name: 'Kelly O\'Brien',        role: 'TEACHER',          phone: '+15552000020', siteIds: [ID.washington] },
    { id: uuid('b000', 0x101b), email: 'teacher12@washington.edu', name: 'Lawrence Adams',        role: 'TEACHER',          phone: '+15552000021', siteIds: [ID.washington] },
    { id: uuid('b000', 0x1030), email: 'responder1@washington.edu', name: 'Officer Maria Santos', role: 'FIRST_RESPONDER',  phone: '+15552000030', siteIds: [ID.washington] },
    { id: uuid('b000', 0x1040), email: 'parent1@washington.edu',   name: 'Sandra Williams',       role: 'PARENT',           phone: '+15552000040', siteIds: [ID.washington] },
    { id: uuid('b000', 0x1041), email: 'parent2@washington.edu',   name: 'Michael Chen',          role: 'PARENT',           phone: '+15552000041', siteIds: [ID.washington] },
    { id: uuid('b000', 0x1042), email: 'parent3@washington.edu',   name: 'Fatima Al-Rashid',      role: 'PARENT',           phone: '+15552000042', siteIds: [ID.washington] },
    { id: uuid('b000', 0x1043), email: 'parent4@washington.edu',   name: 'Roberto Garcia',        role: 'PARENT',           phone: '+15552000043', siteIds: [ID.washington] },
    { id: uuid('b000', 0x1044), email: 'parent5@washington.edu',   name: 'Keiko Tanaka',          role: 'PARENT',           phone: '+15552000044', siteIds: [ID.washington] },
    { id: uuid('b000', 0x1045), email: 'parent6@washington.edu',   name: 'David Okafor',          role: 'PARENT',           phone: '+15552000045', siteIds: [ID.washington] },
    { id: uuid('b000', 0x1046), email: 'parent7@washington.edu',   name: 'Lisa Martinez',         role: 'PARENT',           phone: '+15552000046', siteIds: [ID.washington] },

    // ---- Jefferson High School ----
    { id: uuid('c000', 0x1001), email: 'admin@jefferson.edu',      name: 'Dr. Patricia Sullivan', role: 'SITE_ADMIN',       phone: '+15553000001', siteIds: [ID.jefferson] },
    { id: uuid('c000', 0x1002), email: 'security1@jefferson.edu',  name: 'Anthony Morales',       role: 'OPERATOR',         phone: '+15553000002', siteIds: [ID.jefferson] },
    { id: uuid('c000', 0x1003), email: 'security2@jefferson.edu',  name: 'Brenda Foster',         role: 'OPERATOR',         phone: '+15553000003', siteIds: [ID.jefferson] },
    { id: uuid('c000', 0x1004), email: 'security3@jefferson.edu',  name: 'Carlos Reyes',          role: 'OPERATOR',         phone: '+15553000004', siteIds: [ID.jefferson] },
    { id: uuid('c000', 0x1010), email: 'teacher1@jefferson.edu',   name: 'Diana Wu',              role: 'TEACHER',          phone: '+15553000010', wearableDeviceId: 'CX-JEF-001', siteIds: [ID.jefferson] },
    { id: uuid('c000', 0x1011), email: 'teacher2@jefferson.edu',   name: 'Edward Brown',          role: 'TEACHER',          phone: '+15553000011', wearableDeviceId: 'CX-JEF-002', siteIds: [ID.jefferson] },
    { id: uuid('c000', 0x1012), email: 'teacher3@jefferson.edu',   name: 'Fiona McCarthy',        role: 'TEACHER',          phone: '+15553000012', siteIds: [ID.jefferson] },
    { id: uuid('c000', 0x1013), email: 'teacher4@jefferson.edu',   name: 'George Patel',          role: 'TEACHER',          phone: '+15553000013', siteIds: [ID.jefferson] },
    { id: uuid('c000', 0x1014), email: 'teacher5@jefferson.edu',   name: 'Hannah Johansson',      role: 'TEACHER',          phone: '+15553000014', siteIds: [ID.jefferson] },
    { id: uuid('c000', 0x1015), email: 'teacher6@jefferson.edu',   name: 'Isaac Rivera',          role: 'TEACHER',          phone: '+15553000015', siteIds: [ID.jefferson] },
    { id: uuid('c000', 0x1016), email: 'teacher7@jefferson.edu',   name: 'Julia Kim',             role: 'TEACHER',          phone: '+15553000016', siteIds: [ID.jefferson] },
    { id: uuid('c000', 0x1017), email: 'teacher8@jefferson.edu',   name: 'Kevin O\'Neill',        role: 'TEACHER',          phone: '+15553000017', siteIds: [ID.jefferson] },
    { id: uuid('c000', 0x1018), email: 'teacher9@jefferson.edu',   name: 'Leah Washington',       role: 'TEACHER',          phone: '+15553000018', siteIds: [ID.jefferson] },
    { id: uuid('c000', 0x1019), email: 'teacher10@jefferson.edu',  name: 'Matthew Singh',         role: 'TEACHER',          phone: '+15553000019', siteIds: [ID.jefferson] },
    { id: uuid('c000', 0x101a), email: 'teacher11@jefferson.edu',  name: 'Nina Volkov',           role: 'TEACHER',          phone: '+15553000020', siteIds: [ID.jefferson] },
    { id: uuid('c000', 0x101b), email: 'teacher12@jefferson.edu',  name: 'Oscar Medina',          role: 'TEACHER',          phone: '+15553000021', siteIds: [ID.jefferson] },
    { id: uuid('c000', 0x101c), email: 'teacher13@jefferson.edu',  name: 'Priya Sharma',          role: 'TEACHER',          phone: '+15553000022', siteIds: [ID.jefferson] },
    { id: uuid('c000', 0x101d), email: 'teacher14@jefferson.edu',  name: 'Quinn Harper',          role: 'TEACHER',          phone: '+15553000023', siteIds: [ID.jefferson] },
    { id: uuid('c000', 0x101e), email: 'teacher15@jefferson.edu',  name: 'Rachel Torres',         role: 'TEACHER',          phone: '+15553000024', siteIds: [ID.jefferson] },
    { id: uuid('c000', 0x1030), email: 'responder1@jefferson.edu', name: 'Sgt. Marcus Hall',      role: 'FIRST_RESPONDER',  phone: '+15553000030', siteIds: [ID.jefferson] },
    { id: uuid('c000', 0x1031), email: 'responder2@jefferson.edu', name: 'Officer Kelly Chen',    role: 'FIRST_RESPONDER',  phone: '+15553000031', siteIds: [ID.jefferson] },
    { id: uuid('c000', 0x1040), email: 'parent1@jefferson.edu',    name: 'Steven Taylor',         role: 'PARENT',           phone: '+15553000040', siteIds: [ID.jefferson] },
    { id: uuid('c000', 0x1041), email: 'parent2@jefferson.edu',    name: 'Tamara Brooks',         role: 'PARENT',           phone: '+15553000041', siteIds: [ID.jefferson] },
    { id: uuid('c000', 0x1042), email: 'parent3@jefferson.edu',    name: 'Umar Hassan',           role: 'PARENT',           phone: '+15553000042', siteIds: [ID.jefferson] },
    { id: uuid('c000', 0x1043), email: 'parent4@jefferson.edu',    name: 'Valerie Dupont',        role: 'PARENT',           phone: '+15553000043', siteIds: [ID.jefferson] },
    { id: uuid('c000', 0x1044), email: 'parent5@jefferson.edu',    name: 'William Nakamura',      role: 'PARENT',           phone: '+15553000044', siteIds: [ID.jefferson] },
    { id: uuid('c000', 0x1045), email: 'parent6@jefferson.edu',    name: 'Xena Papadopoulos',     role: 'PARENT',           phone: '+15553000045', siteIds: [ID.jefferson] },
    { id: uuid('c000', 0x1046), email: 'parent7@jefferson.edu',    name: 'Yolanda Ruiz',          role: 'PARENT',           phone: '+15553000046', siteIds: [ID.jefferson] },
    { id: uuid('c000', 0x1047), email: 'parent8@jefferson.edu',    name: 'Zachary Bennett',       role: 'PARENT',           phone: '+15553000047', siteIds: [ID.jefferson] },
    { id: uuid('c000', 0x1048), email: 'parent9@jefferson.edu',    name: 'Alice Okonkwo',         role: 'PARENT',           phone: '+15553000048', siteIds: [ID.jefferson] },
    { id: uuid('c000', 0x1049), email: 'parent10@jefferson.edu',   name: 'Brian Yamamoto',        role: 'PARENT',           phone: '+15553000049', siteIds: [ID.jefferson] },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { id: u.id },
      update: {},
      create: {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        phone: u.phone ?? null,
        wearableDeviceId: u.wearableDeviceId ?? null,
        passwordHash: DEV_PASSWORD_HASH,
        sites: {
          connectOrCreate: u.siteIds.map(sId => ({
            where: { userId_siteId: { userId: u.id, siteId: sId } },
            create: { siteId: sId },
          })),
        },
      },
    });
  }
  console.log(`       ${users.length} users created`);

  // --------------------------------------------------------------------------
  // Doors
  // --------------------------------------------------------------------------
  console.log('6/12  Doors...');

  type DoorDef = {
    id: string; siteId: string; buildingId: string; name: string;
    floor: number; zone: string; isExterior: boolean; isEmergencyExit: boolean;
    status?: 'LOCKED' | 'UNLOCKED' | 'FORCED';
  };

  const doors: DoorDef[] = [
    // Lincoln (10)
    { id: uuid('a000', 0x2001), siteId: ID.lincoln, buildingId: ID.linMain,  name: 'Main Entrance',         floor: 1, zone: 'entrance',  isExterior: true,  isEmergencyExit: false },
    { id: uuid('a000', 0x2002), siteId: ID.lincoln, buildingId: ID.linMain,  name: 'South Emergency Exit',  floor: 1, zone: 'south',     isExterior: true,  isEmergencyExit: true },
    { id: uuid('a000', 0x2003), siteId: ID.lincoln, buildingId: ID.linMain,  name: 'Office Door',           floor: 1, zone: 'admin',     isExterior: false, isEmergencyExit: false },
    { id: uuid('a000', 0x2004), siteId: ID.lincoln, buildingId: ID.linMain,  name: 'Cafeteria Door',        floor: 1, zone: 'common',    isExterior: false, isEmergencyExit: false },
    { id: uuid('a000', 0x2005), siteId: ID.lincoln, buildingId: ID.linMain,  name: 'Gym External Door',     floor: 1, zone: 'athletics', isExterior: true,  isEmergencyExit: true },
    { id: uuid('a000', 0x2006), siteId: ID.lincoln, buildingId: ID.linMain,  name: 'Hallway Fire Door',     floor: 1, zone: 'hallway',   isExterior: false, isEmergencyExit: false },
    { id: uuid('a000', 0x2007), siteId: ID.lincoln, buildingId: ID.linMain,  name: 'Library Door',          floor: 1, zone: 'common',    isExterior: false, isEmergencyExit: false },
    { id: uuid('a000', 0x2008), siteId: ID.lincoln, buildingId: ID.linMain,  name: 'North Stairwell',       floor: 1, zone: 'hallway',   isExterior: false, isEmergencyExit: false },
    { id: uuid('a000', 0x2009), siteId: ID.lincoln, buildingId: ID.linAnnex, name: 'Annex Entrance',        floor: 1, zone: 'entrance',  isExterior: true,  isEmergencyExit: false },
    { id: uuid('a000', 0x200a), siteId: ID.lincoln, buildingId: ID.linAnnex, name: 'Annex Emergency Exit',  floor: 1, zone: 'south',     isExterior: true,  isEmergencyExit: true },

    // Washington (15)
    { id: uuid('b000', 0x2001), siteId: ID.washington, buildingId: ID.wasMain,    name: 'Main Entrance',         floor: 1, zone: 'entrance',  isExterior: true,  isEmergencyExit: false },
    { id: uuid('b000', 0x2002), siteId: ID.washington, buildingId: ID.wasMain,    name: 'South Exit',            floor: 1, zone: 'south',     isExterior: true,  isEmergencyExit: true },
    { id: uuid('b000', 0x2003), siteId: ID.washington, buildingId: ID.wasMain,    name: 'East Exit',             floor: 1, zone: 'east',      isExterior: true,  isEmergencyExit: true },
    { id: uuid('b000', 0x2004), siteId: ID.washington, buildingId: ID.wasMain,    name: 'Office Door',           floor: 1, zone: 'admin',     isExterior: false, isEmergencyExit: false },
    { id: uuid('b000', 0x2005), siteId: ID.washington, buildingId: ID.wasMain,    name: 'Cafeteria Door',        floor: 1, zone: 'common',    isExterior: false, isEmergencyExit: false },
    { id: uuid('b000', 0x2006), siteId: ID.washington, buildingId: ID.wasMain,    name: '2nd Floor Fire Door',   floor: 2, zone: 'hallway',   isExterior: false, isEmergencyExit: false },
    { id: uuid('b000', 0x2007), siteId: ID.washington, buildingId: ID.wasMain,    name: '3rd Floor Fire Door',   floor: 3, zone: 'hallway',   isExterior: false, isEmergencyExit: false },
    { id: uuid('b000', 0x2008), siteId: ID.washington, buildingId: ID.wasMain,    name: 'Library Door',          floor: 1, zone: 'common',    isExterior: false, isEmergencyExit: false },
    { id: uuid('b000', 0x2009), siteId: ID.washington, buildingId: ID.wasMain,    name: 'Loading Dock',          floor: 1, zone: 'service',   isExterior: true,  isEmergencyExit: false },
    { id: uuid('b000', 0x200a), siteId: ID.washington, buildingId: ID.wasGym,     name: 'Gym Main Door',         floor: 1, zone: 'athletics', isExterior: true,  isEmergencyExit: false },
    { id: uuid('b000', 0x200b), siteId: ID.washington, buildingId: ID.wasGym,     name: 'Gym Emergency Exit',    floor: 1, zone: 'athletics', isExterior: true,  isEmergencyExit: true },
    { id: uuid('b000', 0x200c), siteId: ID.washington, buildingId: ID.wasScience, name: 'Science Wing Entrance', floor: 1, zone: 'academic',  isExterior: false, isEmergencyExit: false },
    { id: uuid('b000', 0x200d), siteId: ID.washington, buildingId: ID.wasScience, name: 'Science Wing Exit',     floor: 1, zone: 'academic',  isExterior: true,  isEmergencyExit: true },
    { id: uuid('b000', 0x200e), siteId: ID.washington, buildingId: ID.wasMain,    name: 'Guidance Office Door',  floor: 1, zone: 'admin',     isExterior: false, isEmergencyExit: false, status: 'UNLOCKED' },
    { id: uuid('b000', 0x200f), siteId: ID.washington, buildingId: ID.wasMain,    name: 'Stairwell B',           floor: 2, zone: 'hallway',   isExterior: false, isEmergencyExit: false },

    // Jefferson (20) — note: some doors will be LOCKED (active lockdown scenario)
    { id: uuid('c000', 0x2001), siteId: ID.jefferson, buildingId: ID.jefMain, name: 'Main Entrance',         floor: 1, zone: 'entrance',  isExterior: true,  isEmergencyExit: false },
    { id: uuid('c000', 0x2002), siteId: ID.jefferson, buildingId: ID.jefMain, name: 'South Emergency Exit',  floor: 1, zone: 'south',     isExterior: true,  isEmergencyExit: true },
    { id: uuid('c000', 0x2003), siteId: ID.jefferson, buildingId: ID.jefMain, name: 'East Emergency Exit',   floor: 1, zone: 'east',      isExterior: true,  isEmergencyExit: true },
    { id: uuid('c000', 0x2004), siteId: ID.jefferson, buildingId: ID.jefMain, name: 'Office Door',           floor: 1, zone: 'admin',     isExterior: false, isEmergencyExit: false },
    { id: uuid('c000', 0x2005), siteId: ID.jefferson, buildingId: ID.jefMain, name: 'Cafeteria Door',        floor: 1, zone: 'common',    isExterior: false, isEmergencyExit: false },
    { id: uuid('c000', 0x2006), siteId: ID.jefferson, buildingId: ID.jefMain, name: 'Library Door',          floor: 1, zone: 'common',    isExterior: false, isEmergencyExit: false },
    { id: uuid('c000', 0x2007), siteId: ID.jefferson, buildingId: ID.jefMain, name: '2nd Floor Fire Door',   floor: 2, zone: 'hallway',   isExterior: false, isEmergencyExit: false },
    { id: uuid('c000', 0x2008), siteId: ID.jefferson, buildingId: ID.jefMain, name: '3rd Floor Fire Door',   floor: 3, zone: 'hallway',   isExterior: false, isEmergencyExit: false },
    { id: uuid('c000', 0x2009), siteId: ID.jefferson, buildingId: ID.jefMain, name: 'North Stairwell A',     floor: 1, zone: 'hallway',   isExterior: false, isEmergencyExit: false },
    { id: uuid('c000', 0x200a), siteId: ID.jefferson, buildingId: ID.jefMain, name: 'North Stairwell B',     floor: 2, zone: 'hallway',   isExterior: false, isEmergencyExit: false },
    { id: uuid('c000', 0x200b), siteId: ID.jefferson, buildingId: ID.jefMain, name: 'Loading Dock',          floor: 1, zone: 'service',   isExterior: true,  isEmergencyExit: false },
    { id: uuid('c000', 0x200c), siteId: ID.jefferson, buildingId: ID.jefWest, name: 'West Wing Entrance',    floor: 1, zone: 'academic',  isExterior: false, isEmergencyExit: false },
    { id: uuid('c000', 0x200d), siteId: ID.jefferson, buildingId: ID.jefWest, name: 'West Wing Exit',        floor: 1, zone: 'academic',  isExterior: true,  isEmergencyExit: true },
    { id: uuid('c000', 0x200e), siteId: ID.jefferson, buildingId: ID.jefWest, name: 'Lab Emergency Exit',    floor: 1, zone: 'academic',  isExterior: true,  isEmergencyExit: true },
    { id: uuid('c000', 0x200f), siteId: ID.jefferson, buildingId: ID.jefGym,  name: 'Athletic Center Main',  floor: 1, zone: 'athletics', isExterior: true,  isEmergencyExit: false },
    { id: uuid('c000', 0x2010), siteId: ID.jefferson, buildingId: ID.jefGym,  name: 'Athletic Center Exit',  floor: 1, zone: 'athletics', isExterior: true,  isEmergencyExit: true },
    { id: uuid('c000', 0x2011), siteId: ID.jefferson, buildingId: ID.jefGym,  name: 'Pool Emergency Exit',   floor: 1, zone: 'athletics', isExterior: true,  isEmergencyExit: true },
    { id: uuid('c000', 0x2012), siteId: ID.jefferson, buildingId: ID.jefArts, name: 'Auditorium Main',       floor: 1, zone: 'arts',      isExterior: true,  isEmergencyExit: false },
    { id: uuid('c000', 0x2013), siteId: ID.jefferson, buildingId: ID.jefArts, name: 'Auditorium Exit A',     floor: 1, zone: 'arts',      isExterior: true,  isEmergencyExit: true },
    { id: uuid('c000', 0x2014), siteId: ID.jefferson, buildingId: ID.jefArts, name: 'Auditorium Exit B',     floor: 1, zone: 'arts',      isExterior: true,  isEmergencyExit: true },
  ];

  for (const d of doors) {
    await prisma.door.upsert({
      where: { id: d.id },
      update: {},
      create: {
        id: d.id,
        siteId: d.siteId,
        buildingId: d.buildingId,
        name: d.name,
        floor: d.floor,
        zone: d.zone,
        status: d.status ?? 'LOCKED',
        isExterior: d.isExterior,
        isEmergencyExit: d.isEmergencyExit,
        controllerType: 'sicunet',
        controllerId: `SIC-${d.id.slice(-4)}`,
      },
    });
  }
  console.log(`       ${doors.length} doors created`);

  // --------------------------------------------------------------------------
  // Transportation (Buses, Routes, Stops, Students, Cards)
  // --------------------------------------------------------------------------
  console.log('7/12  Transportation...');

  // Helper refs for student/parent linking
  const busData = [
    // Lincoln (3 buses)
    { busId: uuid('a000', 0x3001), siteId: ID.lincoln, num: '42',  driverId: uuid('a000', 0x1030) },
    { busId: uuid('a000', 0x3002), siteId: ID.lincoln, num: '17',  driverId: null },
    { busId: uuid('a000', 0x3003), siteId: ID.lincoln, num: '85',  driverId: null },
    // Washington (4 buses)
    { busId: uuid('b000', 0x3001), siteId: ID.washington, num: '23', driverId: null },
    { busId: uuid('b000', 0x3002), siteId: ID.washington, num: '31', driverId: null },
    { busId: uuid('b000', 0x3003), siteId: ID.washington, num: '56', driverId: null },
    { busId: uuid('b000', 0x3004), siteId: ID.washington, num: '72', driverId: null },
    // Jefferson (5 buses)
    { busId: uuid('c000', 0x3001), siteId: ID.jefferson, num: '11', driverId: null },
    { busId: uuid('c000', 0x3002), siteId: ID.jefferson, num: '33', driverId: null },
    { busId: uuid('c000', 0x3003), siteId: ID.jefferson, num: '47', driverId: null },
    { busId: uuid('c000', 0x3004), siteId: ID.jefferson, num: '62', driverId: null },
    { busId: uuid('c000', 0x3005), siteId: ID.jefferson, num: '99', driverId: null },
  ];

  for (const b of busData) {
    await prisma.bus.upsert({
      where: { id: b.busId },
      update: {},
      create: {
        id: b.busId,
        siteId: b.siteId,
        busNumber: b.num,
        driverId: b.driverId,
        capacity: 72,
        hasRfidReader: true,
        hasPanicButton: true,
        hasCameras: true,
        isActive: true,
        // Demo scenario: Bus #42 is in transit near Lincoln Elementary
        ...(b.num === '42' ? {
          currentLatitude: 40.7370,
          currentLongitude: -74.1710,
          currentSpeed: 18.5,
          currentHeading: 195,
          lastGpsAt: new Date(),
          currentStudentCount: 2,
        } : {}),
      },
    });
  }

  // Routes + stops (one route per school for brevity)
  const routeDefs = [
    { id: uuid('a000', 0x3010), siteId: ID.lincoln,    name: 'Morning Route 1 - North', num: 'LIN-AM-1', dep: '07:00', arr: '07:45', am: true },
    { id: uuid('b000', 0x3010), siteId: ID.washington,  name: 'Morning Route 1 - East',  num: 'WAS-AM-1', dep: '07:15', arr: '08:00', am: true },
    { id: uuid('c000', 0x3010), siteId: ID.jefferson,   name: 'Morning Route 1 - South', num: 'JEF-AM-1', dep: '06:45', arr: '07:30', am: true },
  ];

  for (const r of routeDefs) {
    await prisma.busRoute.upsert({
      where: { id: r.id },
      update: {},
      create: {
        id: r.id, siteId: r.siteId, name: r.name, routeNumber: r.num,
        scheduledDepartureTime: r.dep, scheduledArrivalTime: r.arr,
        isAmRoute: r.am, isPmRoute: false,
      },
    });
  }

  // Bus-route assignments
  const busRouteAssign = [
    { id: uuid('a000', 0x3020), busId: uuid('a000', 0x3001), routeId: uuid('a000', 0x3010) },
    { id: uuid('b000', 0x3020), busId: uuid('b000', 0x3001), routeId: uuid('b000', 0x3010) },
    { id: uuid('c000', 0x3020), busId: uuid('c000', 0x3001), routeId: uuid('c000', 0x3010) },
  ];
  for (const a of busRouteAssign) {
    await prisma.busRouteAssignment.upsert({
      where: { id: a.id },
      update: {},
      create: a,
    });
  }

  // Stops (3 per route)
  const stopDefs = [
    // Lincoln
    { id: uuid('a000', 0x3100), routeId: uuid('a000', 0x3010), name: 'Oak Street & 5th Ave',  addr: '100 Oak St, Newark, NJ 07104',   lat: 40.7400, lng: -74.1700, time: '07:05', ord: 1 },
    { id: uuid('a000', 0x3101), routeId: uuid('a000', 0x3010), name: 'Maple Drive & Park Blvd', addr: '200 Maple Dr, Newark, NJ 07104', lat: 40.7380, lng: -74.1710, time: '07:15', ord: 2 },
    { id: uuid('a000', 0x3102), routeId: uuid('a000', 0x3010), name: 'Lincoln Elementary',    addr: '123 Lincoln Ave, Newark, NJ 07104', lat: 40.7357, lng: -74.1724, time: '07:45', ord: 3 },
    // Washington
    { id: uuid('b000', 0x3100), routeId: uuid('b000', 0x3010), name: 'Elm Street & 3rd Ave',  addr: '300 Elm St, Newark, NJ 07106',    lat: 40.7300, lng: -74.1890, time: '07:20', ord: 1 },
    { id: uuid('b000', 0x3101), routeId: uuid('b000', 0x3010), name: 'Pine Road & Market St', addr: '150 Pine Rd, Newark, NJ 07106',   lat: 40.7290, lng: -74.1905, time: '07:35', ord: 2 },
    { id: uuid('b000', 0x3102), routeId: uuid('b000', 0x3010), name: 'Washington Middle School', addr: '456 Washington Blvd, Newark, NJ 07106', lat: 40.7282, lng: -74.1912, time: '08:00', ord: 3 },
    // Jefferson
    { id: uuid('c000', 0x3100), routeId: uuid('c000', 0x3010), name: 'Broad St & Central Ave', addr: '500 Broad St, Newark, NJ 07108', lat: 40.7210, lng: -74.1980, time: '06:50', ord: 1 },
    { id: uuid('c000', 0x3101), routeId: uuid('c000', 0x3010), name: 'MLK Blvd & Orange St', addr: '250 MLK Blvd, Newark, NJ 07108', lat: 40.7200, lng: -74.1995, time: '07:05', ord: 2 },
    { id: uuid('c000', 0x3102), routeId: uuid('c000', 0x3010), name: 'Jefferson High School', addr: '789 Jefferson St, Newark, NJ 07108', lat: 40.7195, lng: -74.2001, time: '07:30', ord: 3 },
  ];
  for (const s of stopDefs) {
    await prisma.busStop.upsert({
      where: { id: s.id },
      update: {},
      create: {
        id: s.id, routeId: s.routeId, name: s.name, address: s.addr,
        latitude: s.lat, longitude: s.lng, scheduledTime: s.time, stopOrder: s.ord,
      },
    });
  }

  // Students — realistic roster across all three schools
  type StudentDef = {
    id: string; siteId: string; fn: string; ln: string; num: string; grade: string;
    dob: string; bld: string; room: string;
    medical?: string; allergies?: string; badgePrinted?: boolean; inactive?: boolean;
  };

  const studentDefs: StudentDef[] = [
    // ---- Lincoln Elementary (K-5) — 20 students ----
    { id: uuid('a000', 0x7001), siteId: ID.lincoln, fn: 'Alex',      ln: 'Thompson',   num: 'STU-LIN-001', grade: '3',   dob: '2017-03-15', bld: ID.linMain, room: uuid('a000', 0x101), badgePrinted: true },
    { id: uuid('a000', 0x7002), siteId: ID.lincoln, fn: 'Maya',      ln: 'Patel',       num: 'STU-LIN-002', grade: '4',   dob: '2016-07-22', bld: ID.linMain, room: uuid('a000', 0x102), badgePrinted: true, allergies: 'Peanuts, tree nuts' },
    { id: uuid('a000', 0x7003), siteId: ID.lincoln, fn: 'Ethan',     ln: 'Rivera',      num: 'STU-LIN-003', grade: 'K',   dob: '2020-01-08', bld: ID.linMain, room: uuid('a000', 0x103) },
    { id: uuid('a000', 0x7004), siteId: ID.lincoln, fn: 'Olivia',    ln: 'Kim',         num: 'STU-LIN-004', grade: 'K',   dob: '2020-05-19', bld: ID.linMain, room: uuid('a000', 0x103) },
    { id: uuid('a000', 0x7005), siteId: ID.lincoln, fn: 'Liam',      ln: 'Johnson',     num: 'STU-LIN-005', grade: '1',   dob: '2019-09-12', bld: ID.linMain, room: uuid('a000', 0x104), badgePrinted: true, medical: 'Asthma — inhaler in nurse office' },
    { id: uuid('a000', 0x7006), siteId: ID.lincoln, fn: 'Sophia',    ln: 'Zhang',       num: 'STU-LIN-006', grade: '1',   dob: '2019-11-30', bld: ID.linMain, room: uuid('a000', 0x104) },
    { id: uuid('a000', 0x7007), siteId: ID.lincoln, fn: 'Noah',      ln: 'Hernandez',   num: 'STU-LIN-007', grade: '2',   dob: '2018-04-25', bld: ID.linMain, room: uuid('a000', 0x111), badgePrinted: true },
    { id: uuid('a000', 0x7008), siteId: ID.lincoln, fn: 'Emma',      ln: 'Davis',       num: 'STU-LIN-008', grade: '2',   dob: '2018-08-14', bld: ID.linMain, room: uuid('a000', 0x111), allergies: 'Dairy' },
    { id: uuid('a000', 0x7009), siteId: ID.lincoln, fn: 'James',     ln: 'Wilson',      num: 'STU-LIN-009', grade: '3',   dob: '2017-06-03', bld: ID.linMain, room: uuid('a000', 0x101) },
    { id: uuid('a000', 0x700a), siteId: ID.lincoln, fn: 'Ava',       ln: 'Martinez',    num: 'STU-LIN-010', grade: '3',   dob: '2017-12-20', bld: ID.linMain, room: uuid('a000', 0x101), badgePrinted: true, medical: 'Type 1 diabetes — insulin pump' },
    { id: uuid('a000', 0x700b), siteId: ID.lincoln, fn: 'Benjamin',  ln: 'Lee',         num: 'STU-LIN-011', grade: '4',   dob: '2016-02-11', bld: ID.linMain, room: uuid('a000', 0x102) },
    { id: uuid('a000', 0x700c), siteId: ID.lincoln, fn: 'Isabella',  ln: 'Garcia',      num: 'STU-LIN-012', grade: '4',   dob: '2016-10-05', bld: ID.linMain, room: uuid('a000', 0x102), badgePrinted: true },
    { id: uuid('a000', 0x700d), siteId: ID.lincoln, fn: 'Lucas',     ln: 'Brown',       num: 'STU-LIN-013', grade: '5',   dob: '2015-07-17', bld: ID.linMain, room: uuid('a000', 0x112) },
    { id: uuid('a000', 0x700e), siteId: ID.lincoln, fn: 'Mia',       ln: 'Anderson',    num: 'STU-LIN-014', grade: '5',   dob: '2015-03-28', bld: ID.linMain, room: uuid('a000', 0x112), badgePrinted: true, allergies: 'Bee stings — EpiPen in nurse office' },
    { id: uuid('a000', 0x700f), siteId: ID.lincoln, fn: 'Henry',     ln: 'Okafor',      num: 'STU-LIN-015', grade: '2',   dob: '2018-11-09', bld: ID.linMain, room: uuid('a000', 0x111) },
    { id: uuid('a000', 0x7010), siteId: ID.lincoln, fn: 'Charlotte', ln: 'Santos',      num: 'STU-LIN-016', grade: '1',   dob: '2019-06-15', bld: ID.linMain, room: uuid('a000', 0x104), badgePrinted: true },
    { id: uuid('a000', 0x7011), siteId: ID.lincoln, fn: 'Daniel',    ln: 'Park',        num: 'STU-LIN-017', grade: 'K',   dob: '2020-08-22', bld: ID.linMain, room: uuid('a000', 0x103) },
    { id: uuid('a000', 0x7012), siteId: ID.lincoln, fn: 'Amelia',    ln: 'White',       num: 'STU-LIN-018', grade: '5',   dob: '2015-01-14', bld: ID.linMain, room: uuid('a000', 0x112), badgePrinted: true },
    { id: uuid('a000', 0x7013), siteId: ID.lincoln, fn: 'William',   ln: 'Nguyen',      num: 'STU-LIN-019', grade: '3',   dob: '2017-09-07', bld: ID.linMain, room: uuid('a000', 0x101) },
    { id: uuid('a000', 0x7014), siteId: ID.lincoln, fn: 'Harper',    ln: 'Clark',       num: 'STU-LIN-020', grade: '4',   dob: '2016-04-30', bld: ID.linMain, room: uuid('a000', 0x102), inactive: true },

    // ---- Washington Middle School (6-8) — 20 students ----
    { id: uuid('b000', 0x7001), siteId: ID.washington, fn: 'Jordan',   ln: 'Williams',   num: 'STU-WAS-001', grade: '7',  dob: '2013-01-10', bld: ID.wasMain, room: uuid('b000', 0x201), badgePrinted: true },
    { id: uuid('b000', 0x7002), siteId: ID.washington, fn: 'Sophia',   ln: 'Chen',       num: 'STU-WAS-002', grade: '8',  dob: '2012-11-05', bld: ID.wasMain, room: uuid('b000', 0x202), badgePrinted: true, allergies: 'Shellfish' },
    { id: uuid('b000', 0x7003), siteId: ID.washington, fn: 'Tyler',    ln: 'Brooks',     num: 'STU-WAS-003', grade: '6',  dob: '2014-03-20', bld: ID.wasMain, room: uuid('b000', 0x101) },
    { id: uuid('b000', 0x7004), siteId: ID.washington, fn: 'Zoe',      ln: 'Foster',     num: 'STU-WAS-004', grade: '6',  dob: '2014-07-14', bld: ID.wasMain, room: uuid('b000', 0x101), badgePrinted: true },
    { id: uuid('b000', 0x7005), siteId: ID.washington, fn: 'Connor',   ln: 'Adams',      num: 'STU-WAS-005', grade: '6',  dob: '2014-10-02', bld: ID.wasMain, room: uuid('b000', 0x102), medical: 'ADHD — medication at nurse office' },
    { id: uuid('b000', 0x7006), siteId: ID.washington, fn: 'Riley',    ln: 'Pham',       num: 'STU-WAS-006', grade: '7',  dob: '2013-05-18', bld: ID.wasMain, room: uuid('b000', 0x201), badgePrinted: true },
    { id: uuid('b000', 0x7007), siteId: ID.washington, fn: 'Nathan',   ln: 'Diaz',       num: 'STU-WAS-007', grade: '7',  dob: '2013-08-30', bld: ID.wasMain, room: uuid('b000', 0x203) },
    { id: uuid('b000', 0x7008), siteId: ID.washington, fn: 'Lily',     ln: 'Scott',      num: 'STU-WAS-008', grade: '7',  dob: '2013-12-12', bld: ID.wasMain, room: uuid('b000', 0x203), badgePrinted: true, allergies: 'Latex, penicillin' },
    { id: uuid('b000', 0x7009), siteId: ID.washington, fn: 'Owen',     ln: 'Garcia',     num: 'STU-WAS-009', grade: '8',  dob: '2012-02-25', bld: ID.wasMain, room: uuid('b000', 0x204) },
    { id: uuid('b000', 0x700a), siteId: ID.washington, fn: 'Chloe',    ln: 'Jackson',    num: 'STU-WAS-010', grade: '8',  dob: '2012-06-08', bld: ID.wasMain, room: uuid('b000', 0x204), badgePrinted: true },
    { id: uuid('b000', 0x700b), siteId: ID.washington, fn: 'Caleb',    ln: 'Martinez',   num: 'STU-WAS-011', grade: '6',  dob: '2014-11-19', bld: ID.wasMain, room: uuid('b000', 0x102) },
    { id: uuid('b000', 0x700c), siteId: ID.washington, fn: 'Grace',    ln: 'Okonkwo',    num: 'STU-WAS-012', grade: '6',  dob: '2014-01-27', bld: ID.wasMain, room: uuid('b000', 0x103), badgePrinted: true },
    { id: uuid('b000', 0x700d), siteId: ID.washington, fn: 'Elijah',   ln: 'Lee',        num: 'STU-WAS-013', grade: '7',  dob: '2013-04-09', bld: ID.wasMain, room: uuid('b000', 0x201), medical: 'Epilepsy — seizure protocol on file' },
    { id: uuid('b000', 0x700e), siteId: ID.washington, fn: 'Aria',     ln: 'Kim',        num: 'STU-WAS-014', grade: '7',  dob: '2013-09-22', bld: ID.wasMain, room: uuid('b000', 0x203), badgePrinted: true },
    { id: uuid('b000', 0x700f), siteId: ID.washington, fn: 'Isaac',    ln: 'Rodriguez',  num: 'STU-WAS-015', grade: '8',  dob: '2012-03-17', bld: ID.wasMain, room: uuid('b000', 0x301) },
    { id: uuid('b000', 0x7010), siteId: ID.washington, fn: 'Savannah', ln: 'Taylor',     num: 'STU-WAS-016', grade: '8',  dob: '2012-07-04', bld: ID.wasMain, room: uuid('b000', 0x301), badgePrinted: true },
    { id: uuid('b000', 0x7011), siteId: ID.washington, fn: 'Gabriel',  ln: 'Nguyen',     num: 'STU-WAS-017', grade: '8',  dob: '2012-10-31', bld: ID.wasMain, room: uuid('b000', 0x302) },
    { id: uuid('b000', 0x7012), siteId: ID.washington, fn: 'Layla',    ln: 'Hassan',     num: 'STU-WAS-018', grade: '6',  dob: '2014-06-13', bld: ID.wasMain, room: uuid('b000', 0x103), allergies: 'Gluten' },
    { id: uuid('b000', 0x7013), siteId: ID.washington, fn: 'Andrew',   ln: 'Clark',      num: 'STU-WAS-019', grade: '7',  dob: '2013-02-28', bld: ID.wasMain, room: uuid('b000', 0x203), badgePrinted: true },
    { id: uuid('b000', 0x7014), siteId: ID.washington, fn: 'Nora',     ln: 'Wright',     num: 'STU-WAS-020', grade: '8',  dob: '2012-12-15', bld: ID.wasMain, room: uuid('b000', 0x302), inactive: true },

    // ---- Jefferson High School (9-12) — 20 students ----
    { id: uuid('c000', 0x7001), siteId: ID.jefferson, fn: 'Marcus',   ln: 'Taylor',     num: 'STU-JEF-001', grade: '10', dob: '2010-06-18', bld: ID.jefMain, room: uuid('c000', 0x201), badgePrinted: true },
    { id: uuid('c000', 0x7002), siteId: ID.jefferson, fn: 'Aisha',    ln: 'Brooks',     num: 'STU-JEF-002', grade: '11', dob: '2009-09-30', bld: ID.jefMain, room: uuid('c000', 0x202), badgePrinted: true },
    { id: uuid('c000', 0x7003), siteId: ID.jefferson, fn: 'Dylan',    ln: 'Morales',    num: 'STU-JEF-003', grade: '9',  dob: '2011-02-14', bld: ID.jefMain, room: uuid('c000', 0x101) },
    { id: uuid('c000', 0x7004), siteId: ID.jefferson, fn: 'Jasmine',  ln: 'Patel',      num: 'STU-JEF-004', grade: '9',  dob: '2011-05-22', bld: ID.jefMain, room: uuid('c000', 0x101), badgePrinted: true, allergies: 'Peanuts' },
    { id: uuid('c000', 0x7005), siteId: ID.jefferson, fn: 'Elias',    ln: 'Washington', num: 'STU-JEF-005', grade: '9',  dob: '2011-08-10', bld: ID.jefMain, room: uuid('c000', 0x102) },
    { id: uuid('c000', 0x7006), siteId: ID.jefferson, fn: 'Naomi',    ln: 'Sullivan',   num: 'STU-JEF-006', grade: '10', dob: '2010-01-30', bld: ID.jefMain, room: uuid('c000', 0x201), badgePrinted: true, medical: 'Severe asthma — emergency inhaler in bag' },
    { id: uuid('c000', 0x7007), siteId: ID.jefferson, fn: 'Adrian',   ln: 'Singh',      num: 'STU-JEF-007', grade: '10', dob: '2010-04-25', bld: ID.jefMain, room: uuid('c000', 0x203) },
    { id: uuid('c000', 0x7008), siteId: ID.jefferson, fn: 'Valentina',ln: 'Reyes',      num: 'STU-JEF-008', grade: '10', dob: '2010-09-08', bld: ID.jefMain, room: uuid('c000', 0x203), badgePrinted: true },
    { id: uuid('c000', 0x7009), siteId: ID.jefferson, fn: 'Jayden',   ln: 'Okafor',     num: 'STU-JEF-009', grade: '11', dob: '2009-03-17', bld: ID.jefMain, room: uuid('c000', 0x204) },
    { id: uuid('c000', 0x700a), siteId: ID.jefferson, fn: 'Samantha', ln: 'Foster',     num: 'STU-JEF-010', grade: '11', dob: '2009-07-05', bld: ID.jefMain, room: uuid('c000', 0x204), badgePrinted: true, allergies: 'Penicillin, sulfa drugs' },
    { id: uuid('c000', 0x700b), siteId: ID.jefferson, fn: 'Xavier',   ln: 'Dupont',     num: 'STU-JEF-011', grade: '11', dob: '2009-11-21', bld: ID.jefMain, room: uuid('c000', 0x301) },
    { id: uuid('c000', 0x700c), siteId: ID.jefferson, fn: 'Aaliyah',  ln: 'Chen',       num: 'STU-JEF-012', grade: '12', dob: '2008-04-12', bld: ID.jefMain, room: uuid('c000', 0x301), badgePrinted: true },
    { id: uuid('c000', 0x700d), siteId: ID.jefferson, fn: 'Dominic',  ln: 'Ruiz',       num: 'STU-JEF-013', grade: '12', dob: '2008-08-29', bld: ID.jefMain, room: uuid('c000', 0x302), medical: 'Type 1 diabetes — insulin pump, nurse notified' },
    { id: uuid('c000', 0x700e), siteId: ID.jefferson, fn: 'Skylar',   ln: 'Bennett',    num: 'STU-JEF-014', grade: '12', dob: '2008-12-01', bld: ID.jefMain, room: uuid('c000', 0x302), badgePrinted: true },
    { id: uuid('c000', 0x700f), siteId: ID.jefferson, fn: 'Kai',      ln: 'Yamamoto',   num: 'STU-JEF-015', grade: '9',  dob: '2011-10-15', bld: ID.jefMain, room: uuid('c000', 0x102) },
    { id: uuid('c000', 0x7010), siteId: ID.jefferson, fn: 'Destiny',  ln: 'Williams',   num: 'STU-JEF-016', grade: '10', dob: '2010-12-07', bld: ID.jefMain, room: uuid('c000', 0x203), badgePrinted: true },
    { id: uuid('c000', 0x7011), siteId: ID.jefferson, fn: 'Leo',      ln: 'Nakamura',   num: 'STU-JEF-017', grade: '9',  dob: '2011-03-03', bld: ID.jefMain, room: uuid('c000', 0x103) },
    { id: uuid('c000', 0x7012), siteId: ID.jefferson, fn: 'Camila',   ln: 'Harper',     num: 'STU-JEF-018', grade: '11', dob: '2009-06-19', bld: ID.jefMain, room: uuid('c000', 0x202), badgePrinted: true },
    { id: uuid('c000', 0x7013), siteId: ID.jefferson, fn: 'Miles',    ln: 'Papadopoulos', num: 'STU-JEF-019', grade: '12', dob: '2008-02-14', bld: ID.jefMain, room: uuid('c000', 0x303), allergies: 'Latex' },
    { id: uuid('c000', 0x7014), siteId: ID.jefferson, fn: 'Isabelle', ln: 'Hassan',     num: 'STU-JEF-020', grade: '12', dob: '2008-10-20', bld: ID.jefMain, room: uuid('c000', 0x303), badgePrinted: true, inactive: true },
  ];

  const badgePrintedDate = new Date('2026-01-15');

  for (const s of studentDefs) {
    await prisma.student.upsert({
      where: { id: s.id },
      update: {},
      create: {
        id: s.id, siteId: s.siteId, firstName: s.fn, lastName: s.ln,
        studentNumber: s.num, grade: s.grade,
        dateOfBirth: new Date(s.dob), buildingId: s.bld, roomId: s.room,
        enrollmentDate: new Date('2025-09-02'), isActive: s.inactive ? false : true,
        medicalNotes: s.medical ?? null,
        allergies: s.allergies ?? null,
        badgePrintedAt: s.badgePrinted ? badgePrintedDate : null,
      },
    });
  }

  // Student cards — first 2 students per school have stable card IDs (used by parent contacts / transport)
  // plus cards for additional students to show realistic card counts
  const cardIndices = new Set([
    0, 1, 4, 6, 8,          // Lincoln extras
    20, 21, 24, 26,          // Washington extras
    40, 41, 44, 46,          // Jefferson extras
  ]);
  const cardStudents = studentDefs.filter((_s, i) => cardIndices.has(i));

  const cardDefs = cardStudents.map((s) => {
    const prefix = s.siteId === ID.lincoln ? 'a000' : s.siteId === ID.washington ? 'b000' : 'c000';
    const schoolStudents = studentDefs.filter((sd) => sd.siteId === s.siteId);
    const indexInSchool = schoolStudents.indexOf(s);
    // First 2 per school keep stable IDs 0x4001/0x4002 for parent contact references
    const seq = indexInSchool < 2 ? 0x4001 + indexInSchool : 0x4010 + indexInSchool;
    return {
      id: uuid(prefix, seq),
      siteId: s.siteId,
      studentId: s.id,
      studentName: `${s.fn} ${s.ln}`,
      cardId: `RFID-${s.num}`,
      grade: s.grade,
    };
  });

  for (const c of cardDefs) {
    await prisma.studentCard.upsert({
      where: { id: c.id },
      update: { studentId: c.studentId },
      create: { ...c, isActive: true },
    });
  }

  // Parent contacts linked to students
  const parentContactDefs = [
    { id: uuid('a000', 0x5001), studentId: uuid('a000', 0x7001), studentCardId: uuid('a000', 0x4001), name: 'Jennifer Thompson', rel: 'MOTHER', phone: '+15559001001', email: 'jthompson@example.com' },
    { id: uuid('a000', 0x5002), studentId: uuid('a000', 0x7002), studentCardId: uuid('a000', 0x4002), name: 'Raj Patel',         rel: 'FATHER', phone: '+15559001002', email: 'rpatel@example.com' },
    { id: uuid('b000', 0x5001), studentId: uuid('b000', 0x7001), studentCardId: uuid('b000', 0x4001), name: 'Sandra Williams',   rel: 'MOTHER', phone: '+15559002001', email: 'swilliams@example.com' },
    { id: uuid('b000', 0x5002), studentId: uuid('b000', 0x7002), studentCardId: uuid('b000', 0x4002), name: 'Michael Chen',      rel: 'FATHER', phone: '+15559002002', email: 'mchen@example.com' },
    { id: uuid('c000', 0x5001), studentId: uuid('c000', 0x7001), studentCardId: uuid('c000', 0x4001), name: 'Steven Taylor',     rel: 'FATHER', phone: '+15559003001', email: 'staylor@example.com' },
    { id: uuid('c000', 0x5002), studentId: uuid('c000', 0x7002), studentCardId: uuid('c000', 0x4002), name: 'Tamara Brooks',     rel: 'MOTHER', phone: '+15559003002', email: 'tbrooks@example.com' },
  ];
  for (const p of parentContactDefs) {
    await prisma.parentContact.upsert({
      where: { id: p.id },
      update: {},
      create: {
        id: p.id, studentCardId: p.studentCardId, studentId: p.studentId,
        parentName: p.name, relationship: p.rel, phone: p.phone, email: p.email,
      },
    });
  }
  console.log(`       ${busData.length} buses, ${routeDefs.length} routes, ${studentDefs.length} students`);

  // --------------------------------------------------------------------------
  // Visitors
  // --------------------------------------------------------------------------
  console.log('8/12  Visitors...');

  const now = new Date();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600000);
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000);

  type VisitorDef = {
    id: string; siteId: string; firstName: string; lastName: string;
    purpose: string; destination: string;
    hostUserId: string; status: 'PRE_REGISTERED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'DENIED' | 'FLAGGED';
    visitorType?: 'VISITOR' | 'PARENT' | 'CONTRACTOR' | 'VENDOR' | 'VOLUNTEER';
    checkedInAt?: Date; checkedOutAt?: Date;
  };

  const visitors: VisitorDef[] = [
    // Lincoln (5)
    { id: uuid('a000', 0x6001), siteId: ID.lincoln, firstName: 'Robert',   lastName: 'Wilson',    purpose: 'Parent-teacher conference',  destination: 'Room 101', hostUserId: uuid('a000', 0x1010), status: 'PRE_REGISTERED' },
    { id: uuid('a000', 0x6002), siteId: ID.lincoln, firstName: 'Nancy',    lastName: 'Cooper',    purpose: 'Volunteer reading program',  destination: 'Library', hostUserId: uuid('a000', 0x1014), status: 'CHECKED_IN',    visitorType: 'VOLUNTEER', checkedInAt: hoursAgo(2) },
    { id: uuid('a000', 0x6003), siteId: ID.lincoln, firstName: 'Tony',     lastName: 'Martinez',  purpose: 'HVAC maintenance',           destination: 'Mechanical Room', hostUserId: uuid('a000', 0x1002), status: 'CHECKED_OUT', visitorType: 'CONTRACTOR', checkedInAt: daysAgo(1), checkedOutAt: daysAgo(1) },
    { id: uuid('a000', 0x6004), siteId: ID.lincoln, firstName: 'Susan',    lastName: 'Baker',     purpose: 'Lunch delivery',             destination: 'Cafeteria', hostUserId: uuid('a000', 0x1002), status: 'CHECKED_OUT', visitorType: 'VENDOR', checkedInAt: daysAgo(2), checkedOutAt: daysAgo(2) },
    { id: uuid('a000', 0x6005), siteId: ID.lincoln, firstName: 'James',    lastName: 'Hart',      purpose: 'Student pickup',             destination: 'Main Office', hostUserId: uuid('a000', 0x1001), status: 'FLAGGED', visitorType: 'PARENT' },

    // Washington (7) — Demo scenario: visitor checked in with screening
    { id: uuid('b000', 0x6001), siteId: ID.washington, firstName: 'Maria',    lastName: 'Gonzalez', purpose: 'College prep workshop',      destination: 'Room 201', hostUserId: uuid('b000', 0x1010), status: 'CHECKED_IN', visitorType: 'VOLUNTEER', checkedInAt: hoursAgo(1) },
    { id: uuid('b000', 0x6002), siteId: ID.washington, firstName: 'David',    lastName: 'Lee',      purpose: 'IT equipment delivery',      destination: 'Computer Lab', hostUserId: uuid('b000', 0x1002), status: 'CHECKED_IN', visitorType: 'VENDOR', checkedInAt: hoursAgo(3) },
    { id: uuid('b000', 0x6003), siteId: ID.washington, firstName: 'Patricia', lastName: 'Adams',    purpose: 'Guidance counselor meeting',  destination: 'Guidance Office', hostUserId: uuid('b000', 0x1001), status: 'CHECKED_OUT', checkedInAt: daysAgo(1), checkedOutAt: daysAgo(1) },
    { id: uuid('b000', 0x6004), siteId: ID.washington, firstName: 'Richard',  lastName: 'Clark',    purpose: 'Science fair judge',         destination: 'Science Lab 1', hostUserId: uuid('b000', 0x1012), status: 'PRE_REGISTERED', visitorType: 'VOLUNTEER' },
    { id: uuid('b000', 0x6005), siteId: ID.washington, firstName: 'Linda',    lastName: 'Moore',    purpose: 'Substitute teaching',        destination: 'Room 103', hostUserId: uuid('b000', 0x1001), status: 'CHECKED_OUT', checkedInAt: daysAgo(3), checkedOutAt: daysAgo(3) },
    { id: uuid('b000', 0x6006), siteId: ID.washington, firstName: 'Thomas',   lastName: 'Evans',    purpose: 'School board visit',         destination: 'Main Office', hostUserId: uuid('b000', 0x1001), status: 'CHECKED_OUT', checkedInAt: daysAgo(5), checkedOutAt: daysAgo(5) },
    { id: uuid('b000', 0x6007), siteId: ID.washington, firstName: 'Karen',    lastName: 'Wright',   purpose: 'PTA meeting',                destination: 'Cafeteria', hostUserId: uuid('b000', 0x1001), status: 'PRE_REGISTERED', visitorType: 'PARENT' },

    // Jefferson (8)
    { id: uuid('c000', 0x6001), siteId: ID.jefferson, firstName: 'William',  lastName: 'Harris',   purpose: 'Career day speaker',          destination: 'Auditorium', hostUserId: uuid('c000', 0x1010), status: 'CHECKED_IN', checkedInAt: hoursAgo(1) },
    { id: uuid('c000', 0x6002), siteId: ID.jefferson, firstName: 'Elizabeth', lastName: 'King',     purpose: 'Textbook delivery',           destination: 'Library', hostUserId: uuid('c000', 0x1002), status: 'CHECKED_OUT', visitorType: 'VENDOR', checkedInAt: daysAgo(1), checkedOutAt: daysAgo(1) },
    { id: uuid('c000', 0x6003), siteId: ID.jefferson, firstName: 'Charles',  lastName: 'Turner',   purpose: 'Building inspection',         destination: 'Main Building', hostUserId: uuid('c000', 0x1001), status: 'CHECKED_OUT', visitorType: 'CONTRACTOR', checkedInAt: daysAgo(2), checkedOutAt: daysAgo(2) },
    { id: uuid('c000', 0x6004), siteId: ID.jefferson, firstName: 'Dorothy',  lastName: 'Phillips', purpose: 'Student conference',           destination: 'Guidance Office', hostUserId: uuid('c000', 0x1001), status: 'CHECKED_IN', visitorType: 'PARENT', checkedInAt: hoursAgo(2) },
    { id: uuid('c000', 0x6005), siteId: ID.jefferson, firstName: 'Joseph',   lastName: 'Campbell', purpose: 'College recruiter visit',     destination: 'Room 301', hostUserId: uuid('c000', 0x1018), status: 'PRE_REGISTERED' },
    { id: uuid('c000', 0x6006), siteId: ID.jefferson, firstName: 'Margaret', lastName: 'Allen',    purpose: 'After-school tutoring',       destination: 'Room 201', hostUserId: uuid('c000', 0x1013), status: 'CHECKED_OUT', visitorType: 'VOLUNTEER', checkedInAt: daysAgo(1), checkedOutAt: daysAgo(1) },
    { id: uuid('c000', 0x6007), siteId: ID.jefferson, firstName: 'George',   lastName: 'Roberts',  purpose: 'Fire safety inspection',      destination: 'Main Building', hostUserId: uuid('c000', 0x1001), status: 'CHECKED_OUT', visitorType: 'CONTRACTOR', checkedInAt: daysAgo(4), checkedOutAt: daysAgo(4) },
    { id: uuid('c000', 0x6008), siteId: ID.jefferson, firstName: 'Helen',    lastName: 'Mitchell', purpose: 'Band booster meeting',        destination: 'Band Room', hostUserId: uuid('c000', 0x1016), status: 'PRE_REGISTERED', visitorType: 'PARENT' },
  ];

  for (const v of visitors) {
    await prisma.visitor.upsert({
      where: { id: v.id },
      update: {},
      create: {
        id: v.id, siteId: v.siteId, firstName: v.firstName, lastName: v.lastName,
        purpose: v.purpose, destination: v.destination, hostUserId: v.hostUserId,
        status: v.status, visitorType: v.visitorType ?? 'VISITOR',
        checkedInAt: v.checkedInAt ?? null, checkedOutAt: v.checkedOutAt ?? null,
      },
    });
  }

  // Visitor screening for Washington MS checked-in visitors (demo scenario 3)
  await prisma.visitorScreening.upsert({
    where: { visitorId: uuid('b000', 0x6001) },
    update: {},
    create: {
      id: uuid('b000', 0x6801),
      visitorId: uuid('b000', 0x6001),
      sexOffenderCheck: 'CLEAR',
      watchlistCheck: 'CLEAR',
      checkedAt: hoursAgo(1),
    },
  });
  await prisma.visitorScreening.upsert({
    where: { visitorId: uuid('b000', 0x6002) },
    update: {},
    create: {
      id: uuid('b000', 0x6802),
      visitorId: uuid('b000', 0x6002),
      sexOffenderCheck: 'CLEAR',
      watchlistCheck: 'CLEAR',
      checkedAt: hoursAgo(3),
    },
  });
  console.log(`       ${visitors.length} visitors, 2 screenings`);

  // --------------------------------------------------------------------------
  // Alerts + Lockdown (Demo Scenario 1: Active lockdown at Jefferson HS)
  // --------------------------------------------------------------------------
  console.log('9/12  Alerts & Lockdowns...');

  const alertDefs = [
    // Historical resolved alerts
    { id: uuid('a000', 0x8001), siteId: ID.lincoln,    level: 'FIRE' as const,     status: 'RESOLVED' as const, source: 'AUTOMATED' as const, triggeredById: uuid('a000', 0x1002), buildingId: ID.linMain, buildingName: 'Main Building', floor: 1, roomName: 'Kitchen', message: 'Fire alarm triggered in kitchen area - false alarm (burnt popcorn)', triggeredAt: daysAgo(30), resolvedAt: daysAgo(30) },
    { id: uuid('a000', 0x8002), siteId: ID.lincoln,    level: 'MEDICAL' as const,  status: 'RESOLVED' as const, source: 'WEARABLE' as const,  triggeredById: uuid('a000', 0x1010), buildingId: ID.linMain, buildingName: 'Main Building', floor: 1, roomName: 'Room 101', message: 'Student allergic reaction in Room 101 - EpiPen administered', triggeredAt: daysAgo(14), resolvedAt: daysAgo(14) },
    { id: uuid('b000', 0x8001), siteId: ID.washington,  level: 'LOCKDOWN' as const, status: 'RESOLVED' as const, source: 'DASHBOARD' as const, triggeredById: uuid('b000', 0x1001), buildingId: ID.wasMain, buildingName: 'Main Building', floor: 1, roomName: 'Main Office', message: 'Lockdown drill - scheduled monthly practice', triggeredAt: daysAgo(21), resolvedAt: daysAgo(21) },
    { id: uuid('b000', 0x8002), siteId: ID.washington,  level: 'WEATHER' as const,  status: 'RESOLVED' as const, source: 'AUTOMATED' as const, triggeredById: uuid('b000', 0x1002), buildingId: ID.wasMain, buildingName: 'Main Building', floor: 1, roomName: null, message: 'Severe thunderstorm warning - shelter in place activated', triggeredAt: daysAgo(7), resolvedAt: daysAgo(7) },
    { id: uuid('c000', 0x8001), siteId: ID.jefferson,   level: 'MEDICAL' as const,  status: 'RESOLVED' as const, source: 'MOBILE_APP' as const, triggeredById: uuid('c000', 0x1015), buildingId: ID.jefGym, buildingName: 'Athletic Center', floor: 1, roomName: 'Main Gymnasium', message: 'Student injury during basketball practice - EMS dispatched', triggeredAt: daysAgo(10), resolvedAt: daysAgo(10) },

    // ACTIVE LOCKDOWN at Jefferson HS (Demo Scenario 1)
    { id: uuid('c000', 0x8002), siteId: ID.jefferson,   level: 'LOCKDOWN' as const, status: 'TRIGGERED' as const, source: 'WALL_STATION' as const, triggeredById: uuid('c000', 0x1002), buildingId: ID.jefMain, buildingName: 'Main Building', floor: 2, roomName: 'Room 203', message: 'LOCKDOWN INITIATED - Suspicious individual reported near Room 203. All staff secure classrooms immediately.', triggeredAt: new Date(), resolvedAt: null },
  ];

  for (const a of alertDefs) {
    await prisma.alert.upsert({
      where: { id: a.id },
      update: {},
      create: {
        id: a.id, siteId: a.siteId, level: a.level, status: a.status,
        source: a.source, triggeredById: a.triggeredById,
        buildingId: a.buildingId, buildingName: a.buildingName,
        floor: a.floor, roomName: a.roomName,
        message: a.message,
        triggeredAt: a.triggeredAt, resolvedAt: a.resolvedAt,
      },
    });
  }

  // Active lockdown command at Jefferson
  await prisma.lockdownCommand.upsert({
    where: { id: uuid('c000', 0x8101) },
    update: {},
    create: {
      id: uuid('c000', 0x8101),
      siteId: ID.jefferson,
      scope: 'FULL_SITE',
      targetId: ID.jefferson,
      initiatedById: uuid('c000', 0x1002),
      alertId: uuid('c000', 0x8002),
      doorsLocked: 20,
    },
  });
  console.log(`       ${alertDefs.length} alerts (1 active lockdown at Jefferson HS)`);

  // --------------------------------------------------------------------------
  // Drills (compliance tracking)
  // --------------------------------------------------------------------------
  console.log('10/12 Drills...');

  const drillDefs = [
    // Lincoln — missing active threat drill (demo scenario 4)
    { id: uuid('a000', 0x9001), siteId: ID.lincoln, type: 'LOCKDOWN' as const,  status: 'COMPLETED' as const, scheduledAt: daysAgo(60), startedAt: daysAgo(60), completedAt: daysAgo(60), byId: uuid('a000', 0x1001), evac: 180, head: 380, met: true, notes: 'All clear in 3 minutes. Good response time.' },
    { id: uuid('a000', 0x9002), siteId: ID.lincoln, type: 'FIRE' as const,      status: 'COMPLETED' as const, scheduledAt: daysAgo(45), startedAt: daysAgo(45), completedAt: daysAgo(45), byId: uuid('a000', 0x1001), evac: 240, head: 395, met: true, notes: 'Full evacuation in 4 minutes. Room 104 was slow.' },
    { id: uuid('a000', 0x9003), siteId: ID.lincoln, type: 'EVACUATION' as const, status: 'COMPLETED' as const, scheduledAt: daysAgo(30), startedAt: daysAgo(30), completedAt: daysAgo(30), byId: uuid('a000', 0x1001), evac: 300, head: 390, met: true, notes: 'Evacuation to east field. All students accounted for.' },
    // Lincoln — active threat drill NOT done (compliance gap)

    // Washington — fully compliant
    { id: uuid('b000', 0x9001), siteId: ID.washington, type: 'LOCKDOWN' as const,      status: 'COMPLETED' as const, scheduledAt: daysAgo(55), startedAt: daysAgo(55), completedAt: daysAgo(55), byId: uuid('b000', 0x1001), evac: 150, head: 580, met: true, notes: 'Excellent lockdown response. 2.5 minutes.' },
    { id: uuid('b000', 0x9002), siteId: ID.washington, type: 'FIRE' as const,           status: 'COMPLETED' as const, scheduledAt: daysAgo(40), startedAt: daysAgo(40), completedAt: daysAgo(40), byId: uuid('b000', 0x1001), evac: 210, head: 590, met: true, notes: 'Fire drill completed. Science wing evacuated via new route.' },
    { id: uuid('b000', 0x9003), siteId: ID.washington, type: 'EVACUATION' as const,     status: 'COMPLETED' as const, scheduledAt: daysAgo(25), startedAt: daysAgo(25), completedAt: daysAgo(25), byId: uuid('b000', 0x1001), evac: 270, head: 585, met: true, notes: 'Full evacuation drill with reunification practice.' },
    { id: uuid('b000', 0x9004), siteId: ID.washington, type: 'ACTIVE_THREAT' as const,  status: 'COMPLETED' as const, scheduledAt: daysAgo(15), startedAt: daysAgo(15), completedAt: daysAgo(15), byId: uuid('b000', 0x1001), evac: 120, head: 575, met: true, notes: 'Active threat drill with law enforcement participation.' },

    // Jefferson — recent drills
    { id: uuid('c000', 0x9001), siteId: ID.jefferson, type: 'LOCKDOWN' as const,      status: 'COMPLETED' as const, scheduledAt: daysAgo(50), startedAt: daysAgo(50), completedAt: daysAgo(50), byId: uuid('c000', 0x1001), evac: 200, head: 1150, met: true, notes: 'Lockdown completed. West wing had 30-second delay.' },
    { id: uuid('c000', 0x9002), siteId: ID.jefferson, type: 'FIRE' as const,           status: 'COMPLETED' as const, scheduledAt: daysAgo(35), startedAt: daysAgo(35), completedAt: daysAgo(35), byId: uuid('c000', 0x1001), evac: 330, head: 1180, met: true, notes: 'Full campus fire drill. Athletic center evacuation needs improvement.' },
    { id: uuid('c000', 0x9003), siteId: ID.jefferson, type: 'ACTIVE_THREAT' as const,  status: 'COMPLETED' as const, scheduledAt: daysAgo(20), startedAt: daysAgo(20), completedAt: daysAgo(20), byId: uuid('c000', 0x1001), evac: 90,  head: 1160, met: true, notes: 'Active threat drill with SWAT team. Excellent coordination.' },
    { id: uuid('c000', 0x9004), siteId: ID.jefferson, type: 'EVACUATION' as const,     status: 'SCHEDULED' as const, scheduledAt: new Date(now.getTime() + 7 * 86400000), startedAt: null, completedAt: null, byId: uuid('c000', 0x1001), evac: null, head: null, met: null, notes: 'Scheduled full campus evacuation drill.' },
  ];

  for (const d of drillDefs) {
    await prisma.drill.upsert({
      where: { id: d.id },
      update: {},
      create: {
        id: d.id, siteId: d.siteId, type: d.type, status: d.status,
        scheduledAt: d.scheduledAt,
        startedAt: d.startedAt ?? undefined,
        completedAt: d.completedAt ?? undefined,
        initiatedById: d.byId,
        evacuationTimeS: d.evac ?? undefined,
        headCount: d.head ?? undefined,
        complianceMet: d.met ?? undefined,
        notes: d.notes,
      },
    });
  }
  console.log(`       ${drillDefs.length} drills (Lincoln missing active threat drill)`);

  // --------------------------------------------------------------------------
  // Environmental Sensors + Readings (Demo Scenario 5)
  // --------------------------------------------------------------------------
  console.log('11/12 Environmental Sensors & Tips...');

  const sensorDefs = [
    // Lincoln
    { id: uuid('a000', 0xa001), siteId: ID.lincoln,   name: 'Main Hall Temp',     type: 'TEMPERATURE' as const, location: 'Main Hallway, Floor 1' },
    { id: uuid('a000', 0xa002), siteId: ID.lincoln,   name: 'Kitchen Smoke Det',  type: 'SMOKE_DETECTOR' as const, location: 'Kitchen' },
    { id: uuid('a000', 0xa003), siteId: ID.lincoln,   name: 'Cafeteria AQ',       type: 'AIR_QUALITY' as const, location: 'Cafeteria' },
    // Washington
    { id: uuid('b000', 0xa001), siteId: ID.washington, name: 'Science Lab CO',     type: 'CO_DETECTOR' as const, location: 'Science Lab 1' },
    { id: uuid('b000', 0xa002), siteId: ID.washington, name: 'Gym Temp',           type: 'TEMPERATURE' as const, location: 'Main Gymnasium' },
    { id: uuid('b000', 0xa003), siteId: ID.washington, name: 'Computer Lab AQ',    type: 'AIR_QUALITY' as const, location: 'Computer Lab' },
    { id: uuid('b000', 0xa004), siteId: ID.washington, name: 'Boiler Room Temp',   type: 'TEMPERATURE' as const, location: 'Boiler Room, Basement' },
    // Jefferson — includes the high CO2 alert sensor
    { id: uuid('c000', 0xa001), siteId: ID.jefferson,  name: 'Room 301 AQ',        type: 'AIR_QUALITY' as const, location: 'Room 301, Floor 3' },
    { id: uuid('c000', 0xa002), siteId: ID.jefferson,  name: 'Chem Lab CO',        type: 'CO_DETECTOR' as const, location: 'Chemistry Lab' },
    { id: uuid('c000', 0xa003), siteId: ID.jefferson,  name: 'Pool Humidity',      type: 'HUMIDITY' as const, location: 'Pool Area' },
    { id: uuid('c000', 0xa004), siteId: ID.jefferson,  name: 'Main Hall Temp',     type: 'TEMPERATURE' as const, location: 'Main Hallway, Floor 1' },
    { id: uuid('c000', 0xa005), siteId: ID.jefferson,  name: 'Auditorium Smoke',   type: 'SMOKE_DETECTOR' as const, location: 'Auditorium' },
  ];

  for (const s of sensorDefs) {
    await prisma.environmentalSensor.upsert({
      where: { id: s.id },
      update: {},
      create: {
        id: s.id, siteId: s.siteId, name: s.name, type: s.type, location: s.location,
        isOnline: true, lastReading: hoursAgo(1),
      },
    });
  }

  // Readings — normal + one alert (Demo Scenario 5: high CO2 at Jefferson Room 301)
  const readingDefs = [
    { id: uuid('a000', 0xa101), sensorId: uuid('a000', 0xa001), value: 71.2, unit: 'F',   isAlert: false, readAt: hoursAgo(1) },
    { id: uuid('a000', 0xa102), sensorId: uuid('a000', 0xa003), value: 420,  unit: 'ppm', isAlert: false, readAt: hoursAgo(1) },
    { id: uuid('b000', 0xa101), sensorId: uuid('b000', 0xa001), value: 0.5,  unit: 'ppm', isAlert: false, readAt: hoursAgo(1) },
    { id: uuid('b000', 0xa102), sensorId: uuid('b000', 0xa002), value: 68.8, unit: 'F',   isAlert: false, readAt: hoursAgo(1) },
    // HIGH CO2 — Demo Scenario 5
    { id: uuid('c000', 0xa101), sensorId: uuid('c000', 0xa001), value: 1850, unit: 'ppm', isAlert: true,  readAt: hoursAgo(0.5) },
    { id: uuid('c000', 0xa102), sensorId: uuid('c000', 0xa002), value: 1.2,  unit: 'ppm', isAlert: false, readAt: hoursAgo(1) },
    { id: uuid('c000', 0xa103), sensorId: uuid('c000', 0xa003), value: 72,   unit: '%',   isAlert: false, readAt: hoursAgo(1) },
    { id: uuid('c000', 0xa104), sensorId: uuid('c000', 0xa004), value: 72.5, unit: 'F',   isAlert: false, readAt: hoursAgo(1) },
  ];

  for (const r of readingDefs) {
    await prisma.environmentalReading.upsert({
      where: { id: r.id },
      update: {},
      create: r,
    });
  }
  console.log(`       ${sensorDefs.length} sensors, ${readingDefs.length} readings (1 CO2 alert)`);

  // --------------------------------------------------------------------------
  // Anonymous Tips (Demo Scenario 6)
  // --------------------------------------------------------------------------
  const tipDefs = [
    { id: uuid('a000', 0xb001), siteId: ID.lincoln,    category: 'BULLYING' as const,              message: 'Student in 3rd grade is being bullied at recess by older students near the playground equipment.',     severity: 'MEDIUM' as const, status: 'RESOLVED' as const, reviewedById: uuid('a000', 0x1001), reviewedAt: daysAgo(5) },
    { id: uuid('b000', 0xb001), siteId: ID.washington,  category: 'DRUGS' as const,                 message: 'I saw students vaping in the 2nd floor bathroom near Room 204. This happens almost every day after lunch.', severity: 'HIGH' as const, status: 'UNDER_REVIEW' as const },
    { id: uuid('b000', 0xb002), siteId: ID.washington,  category: 'SUSPICIOUS_ACTIVITY' as const,   message: 'There is a white van that has been parked across from the school every morning this week. No markings.', severity: 'HIGH' as const, status: 'INVESTIGATING' as const, reviewedById: uuid('b000', 0x1001), reviewedAt: hoursAgo(4) },
    { id: uuid('c000', 0xb001), siteId: ID.jefferson,   category: 'THREATS' as const,               message: 'A student posted threatening messages on social media about the school. Screenshots available.',    severity: 'CRITICAL' as const, status: 'RESOLVED' as const, reviewedById: uuid('c000', 0x1001), reviewedAt: daysAgo(3) },
    { id: uuid('c000', 0xb002), siteId: ID.jefferson,   category: 'SELF_HARM' as const,             message: 'I am worried about my friend. They have been talking about hurting themselves and seem very depressed.', severity: 'HIGH' as const, status: 'UNDER_REVIEW' as const, reviewedById: uuid('c000', 0x1001), reviewedAt: hoursAgo(2) },
    { id: uuid('c000', 0xb003), siteId: ID.jefferson,   category: 'WEAPONS' as const,               message: 'Heard a student say they were going to bring a knife to school tomorrow.',                            severity: 'CRITICAL' as const, status: 'NEW' as const },
  ];

  for (const t of tipDefs) {
    await prisma.anonymousTip.upsert({
      where: { id: t.id },
      update: {},
      create: {
        id: t.id, siteId: t.siteId, category: t.category, message: t.message,
        severity: t.severity, status: t.status,
        reviewedById: t.reviewedById ?? null,
        reviewedAt: t.reviewedAt ?? null,
        ipHash: 'demo-hash-' + t.id.slice(-4),
      },
    });
  }
  console.log(`       ${tipDefs.length} anonymous tips`);

  // --------------------------------------------------------------------------
  // Visitor Bans (Demo Scenario 7)
  // --------------------------------------------------------------------------
  const banDefs = [
    { id: uuid('d000', 0xc001), siteId: ID.lincoln,    firstName: 'James',  lastName: 'Hart',     reason: 'Flagged on sex offender registry during visitor screening', bannedById: uuid('a000', 0x1001), bannedAt: daysAgo(30) },
    { id: uuid('d000', 0xc002), siteId: ID.washington,  firstName: 'Steven', lastName: 'Blackwell', reason: 'Restraining order filed by custodial parent. Not permitted on school grounds.', bannedById: uuid('b000', 0x1001), bannedAt: daysAgo(90) },
    { id: uuid('d000', 0xc003), siteId: ID.jefferson,   firstName: 'Raymond', lastName: 'Dunn',    reason: 'Previous trespassing incident. Verbal altercation with staff member.', bannedById: uuid('c000', 0x1001), bannedAt: daysAgo(60) },
  ];

  for (const b of banDefs) {
    await prisma.visitorBan.upsert({
      where: { id: b.id },
      update: {},
      create: {
        id: b.id, siteId: b.siteId, firstName: b.firstName, lastName: b.lastName,
        reason: b.reason, bannedById: b.bannedById, bannedAt: b.bannedAt,
        isActive: true,
      },
    });
  }
  console.log(`       ${banDefs.length} visitor bans`);

  // --------------------------------------------------------------------------
  // Threat Reports
  // --------------------------------------------------------------------------
  const threatDefs = [
    { id: uuid('b000', 0xd001), siteId: ID.washington, reportedById: uuid('b000', 0x1010), subjectName: 'Anonymous Student', subjectGrade: '7', subjectRole: 'student', category: 'BEHAVIORAL_CHANGE' as const, description: 'Student has become increasingly withdrawn. Recent drop in grades. Noticed bruises on arms.', riskLevel: 'MODERATE' as const, status: 'UNDER_ASSESSMENT' as const },
    { id: uuid('c000', 0xd001), siteId: ID.jefferson, reportedById: uuid('c000', 0x1011), subjectName: 'Anonymous Student', subjectGrade: '10', subjectRole: 'student', category: 'SOCIAL_MEDIA' as const, description: 'Student posted concerning images and text about violence on Instagram. Screenshots saved.', riskLevel: 'HIGH' as const, status: 'INTERVENTION_ACTIVE' as const, escalatedAt: daysAgo(2) },
    { id: uuid('c000', 0xd002), siteId: ID.jefferson, reportedById: uuid('c000', 0x1014), subjectName: 'Anonymous Student', subjectGrade: '11', subjectRole: 'student', category: 'SELF_HARM' as const, description: 'Student disclosed self-harm to a friend who reported it. Student has history of anxiety.', riskLevel: 'HIGH' as const, status: 'MONITORING' as const },
  ];

  for (const t of threatDefs) {
    await prisma.threatReport.upsert({
      where: { id: t.id },
      update: {},
      create: {
        id: t.id, siteId: t.siteId, reportedById: t.reportedById,
        subjectName: t.subjectName, subjectGrade: t.subjectGrade, subjectRole: t.subjectRole,
        category: t.category, description: t.description, riskLevel: t.riskLevel,
        status: t.status, escalatedAt: t.escalatedAt ?? null,
      },
    });
  }
  console.log(`       ${threatDefs.length} threat reports`);

  // --------------------------------------------------------------------------
  // Social Media Alerts
  // --------------------------------------------------------------------------
  const smaDefs = [
    { id: uuid('b000', 0xe001), siteId: ID.washington, source: 'BARK' as const, platform: 'instagram', contentType: 'text', category: 'BULLYING_CYBER' as const, severity: 'MEDIUM' as const, status: 'REVIEWING' as const, studentName: 'Anonymous', flaggedContent: 'Cyberbullying post targeting another student with threatening language' },
    { id: uuid('c000', 0xe001), siteId: ID.jefferson,  source: 'BARK' as const, platform: 'tiktok',    contentType: 'video', category: 'VIOLENCE_THREAT' as const, severity: 'HIGH' as const, status: 'ESCALATED' as const, studentName: 'Anonymous', flaggedContent: 'Video showing student making threatening gestures toward school property' },
    { id: uuid('c000', 0xe002), siteId: ID.jefferson,  source: 'GAGGLE' as const, platform: 'google_docs', contentType: 'text', category: 'SELF_HARM_RISK' as const, severity: 'CRITICAL' as const, status: 'CONFIRMED' as const, studentName: 'Anonymous', flaggedContent: 'Document containing concerning language about self-harm discovered in school Google Workspace' },
  ];

  for (const s of smaDefs) {
    await prisma.socialMediaAlert.upsert({
      where: { id: s.id },
      update: {},
      create: {
        id: s.id, siteId: s.siteId, source: s.source, platform: s.platform,
        contentType: s.contentType, category: s.category, severity: s.severity,
        status: s.status, studentName: s.studentName, flaggedContent: s.flaggedContent,
      },
    });
  }
  console.log(`       ${smaDefs.length} social media alerts`);

  // --------------------------------------------------------------------------
  // Audit Log entries (recent activity)
  // --------------------------------------------------------------------------
  console.log('12/12 Audit logs...');
  const auditDefs = [
    { id: uuid('a000', 0xf001), siteId: ID.lincoln,    userId: uuid('a000', 0x1001), action: 'LOGIN',          entity: 'User',     entityId: uuid('a000', 0x1001) },
    { id: uuid('a000', 0xf002), siteId: ID.lincoln,    userId: uuid('a000', 0x1002), action: 'DOOR_UNLOCK',    entity: 'Door',     entityId: uuid('a000', 0x2001) },
    { id: uuid('b000', 0xf001), siteId: ID.washington,  userId: uuid('b000', 0x1001), action: 'VISITOR_CHECK_IN', entity: 'Visitor', entityId: uuid('b000', 0x6001) },
    { id: uuid('b000', 0xf002), siteId: ID.washington,  userId: uuid('b000', 0x1002), action: 'LOGIN',          entity: 'User',     entityId: uuid('b000', 0x1002) },
    { id: uuid('c000', 0xf001), siteId: ID.jefferson,   userId: uuid('c000', 0x1002), action: 'LOCKDOWN_INITIATE', entity: 'LockdownCommand', entityId: uuid('c000', 0x8101) },
    { id: uuid('c000', 0xf002), siteId: ID.jefferson,   userId: uuid('c000', 0x1001), action: 'ALERT_TRIGGER',  entity: 'Alert',    entityId: uuid('c000', 0x8002) },
  ];

  for (const a of auditDefs) {
    await prisma.auditLog.upsert({
      where: { id: a.id },
      update: {},
      create: {
        id: a.id, siteId: a.siteId, userId: a.userId,
        action: a.action, entity: a.entity, entityId: a.entityId,
      },
    });
  }
  console.log(`       ${auditDefs.length} audit log entries`);

  // --------------------------------------------------------------------------
  // BadgeKiosk Integration (pre-configured for demo)
  // --------------------------------------------------------------------------
  console.log('13/13 BadgeKiosk integration...');

  const BK_API_URL = 'https://backend-production-345e.up.railway.app';
  const bkIntegrationDefs = [
    { id: uuid('a000', 0xe001), siteId: ID.lincoln,    apiUrl: BK_API_URL, apiKey: 'bk_e64c87be4e841e3af239e6591ef7a1983ea89e667cc16be1', tenantId: '96f5c240-e415-4981-ba37-f3233d83c0ec' },
    { id: uuid('b000', 0xe001), siteId: ID.washington,  apiUrl: BK_API_URL, apiKey: 'bk_592f449684fc040bac32c6d5167f102330ff9d0238d574be', tenantId: '5641d4f9-9f92-4c21-9875-9880f4a35f25' },
    { id: uuid('c000', 0xe001), siteId: ID.jefferson,   apiUrl: BK_API_URL, apiKey: 'bk_265593298c729ca9fd38450c9c4c3d08e0f3595aa813ed2e', tenantId: 'ef1e5fae-ce96-4e23-afb2-3984fe2e56fd' },
  ];

  for (const bk of bkIntegrationDefs) {
    await prisma.badgeKioskIntegration.upsert({
      where: { siteId: bk.siteId },
      update: {},
      create: {
        id: bk.id,
        siteId: bk.siteId,
        apiUrl: bk.apiUrl,
        apiKey: bk.apiKey,
        enabled: true,
        autoSync: true,
        autoPrint: false,
        features: {
          badgePrinting: true,
          guardConsole: true,
          photoVerification: true,
          qrValidation: true,
          visitorPreRegistration: true,
          multiSite: true,
          tier: 'professional',
        },
      },
    });
  }
  console.log(`       ${bkIntegrationDefs.length} BadgeKiosk integrations configured`);

  // --------------------------------------------------------------------------
  // Done
  // --------------------------------------------------------------------------
  console.log('\n=== Demo seed complete! ===');
  console.log(`
Summary:
  Organization: Newark Public Schools
  Sites: 3 (Lincoln Elementary, Washington Middle, Jefferson High)
  Buildings: ${buildingDefs.length}
  Rooms: ${allRooms.length}
  Users: ${users.length}
  Doors: ${doors.length}
  Buses: ${busData.length}
  Students: ${studentDefs.length}
  Visitors: ${visitors.length}
  Alerts: ${alertDefs.length} (1 active lockdown at Jefferson HS)
  Drills: ${drillDefs.length}
  Sensors: ${sensorDefs.length}
  Tips: ${tipDefs.length}
  Visitor Bans: ${banDefs.length}
  Threat Reports: ${threatDefs.length}
  Social Media Alerts: ${smaDefs.length}
  BadgeKiosk Integrations: ${bkIntegrationDefs.length} (all sites)

Demo Scenarios:
  1. Active Lockdown at Jefferson HS (login as admin@jefferson.edu)
  2. Bus #42 in transit near Lincoln Elementary
  3. Visitor checked in at Washington MS with screening
  4. Lincoln Elementary missing active threat drill (compliance gap)
  5. High CO2 reading (1850 ppm) in Jefferson HS Room 301
  6. Anonymous tips under review at Washington MS
  7. Visitor bans across all 3 schools
  8. BadgeKiosk badge printing configured for all sites

All passwords: safeschool123
`);
}

main()
  .catch((e) => {
    console.error('Demo seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
