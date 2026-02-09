#!/bin/sh
echo "=== SafeSchool API Starting ==="
echo "PORT=${PORT:-3000}"
echo "NODE_ENV=${NODE_ENV}"
echo "OPERATING_MODE=${OPERATING_MODE}"
echo "AUTH_PROVIDER=${AUTH_PROVIDER:-dev}"
echo "DATABASE_URL set: $(test -n "$DATABASE_URL" && echo YES || echo NO)"
echo "REDIS_URL set: $(test -n "$REDIS_URL" && echo YES || echo NO)"

echo "=== Running migrations ==="
npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma
echo "=== Migration exit code: $? ==="

echo "=== Seeding essential data ==="
node -e "
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const p = new PrismaClient();
(async () => {
  try {
    const orgId = '00000000-0000-4000-a000-000000008001';
    const siteId = '00000000-0000-4000-a000-000000000001';
    const passwordHash = bcrypt.hashSync('safeschool123', 10);

    await p.organization.upsert({
      where: { id: orgId },
      update: {},
      create: {
        id: orgId,
        name: 'Newark Public Schools',
        slug: 'newark-public-schools',
        type: 'DISTRICT',
        address: '765 Broad St',
        city: 'Newark',
        state: 'NJ',
        zip: '07102',
      }
    });
    console.log('Organization ready');

    await p.site.upsert({
      where: { id: siteId },
      update: { organizationId: orgId },
      create: {
        id: siteId,
        name: 'Lincoln Elementary School',
        district: 'Newark Public Schools',
        organizationId: orgId,
        address: '123 Lincoln Ave',
        city: 'Newark',
        state: 'NJ',
        zip: '07104',
        latitude: 40.7357,
        longitude: -74.1724,
        timezone: 'America/New_York'
      }
    });
    console.log('Site ready');

    const u = await p.user.upsert({
      where: { email: 'bwattendorf@gmail.com' },
      update: { passwordHash: passwordHash },
      create: {
        id: '00000000-0000-4000-a000-000000001000',
        email: 'bwattendorf@gmail.com',
        name: 'Bruce Wattendorf',
        role: 'SITE_ADMIN',
        passwordHash: passwordHash,
        sites: { create: { siteId: siteId } }
      }
    });
    console.log('Owner account ready:', u.email);
  } catch(e) { console.error('Seed error:', e.message); }
  finally { await p.\$disconnect(); }
})();
"

echo "=== Starting Node server ==="
exec node --trace-warnings packages/api/dist/server.js
