#!/bin/sh
echo "=== SafeSchool API Starting ==="
echo "PORT=${PORT:-3000}"
echo "NODE_ENV=${NODE_ENV}"
echo "OPERATING_MODE=${OPERATING_MODE}"
echo "AUTH_PROVIDER=${AUTH_PROVIDER:-dev}"
echo "DATABASE_URL set: $(test -n "$DATABASE_URL" && echo YES || echo NO)"
echo "REDIS_URL set: $(test -n "$REDIS_URL" && echo YES || echo NO)"

if [ -n "$PROPRIETARY_REPO_URL" ]; then
  echo "=== Installing proprietary plugin ==="
  npm install "git+https://x-access-token:${GITHUB_TOKEN}@github.com/${PROPRIETARY_REPO_URL}.git" --no-save

  # Patch Prisma schema with proprietary models
  PROP_DIR=$(node -e "console.log(require.resolve('@safeschool/proprietary').replace(/dist.*/, ''))")
  if [ -f "${PROP_DIR}schema-patch.prisma" ]; then
    # Add relation fields to Site model
    sed -i '/visitorSettings.*SiteVisitorSettings/a\  badgeKioskIntegration   BadgeKioskIntegration?\n  badgeGuardIntegration   BadgeGuardIntegration?' packages/db/prisma/schema.prisma
    cat "${PROP_DIR}schema-patch.prisma" >> packages/db/prisma/schema.prisma
    echo "Schema patched"
  fi

  # Copy migrations
  if [ -d "${PROP_DIR}migrations" ]; then
    cp -r "${PROP_DIR}migrations/"* packages/db/prisma/migrations/
    echo "Migrations copied"
  fi

  # Regenerate Prisma client with new models
  npx prisma generate --schema=packages/db/prisma/schema.prisma
  echo "=== Proprietary plugin installed ==="
fi

echo "=== Running migrations ==="
npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma || {
  echo "=== migrate deploy failed, falling back to db push ==="
  npx prisma db push --schema=packages/db/prisma/schema.prisma --accept-data-loss --skip-generate
}
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
    const seedPassword = process.env.SEED_ADMIN_PASSWORD || 'safeschool123';
    const passwordHash = bcrypt.hashSync(seedPassword, 12);

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

    const userId = '00000000-0000-4000-a000-000000001000';
    const u = await p.user.upsert({
      where: { id: userId },
      update: { passwordHash: passwordHash, email: 'admin@safeschool.example.com' },
      create: {
        id: userId,
        email: 'admin@safeschool.example.com',
        name: 'Admin User',
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
