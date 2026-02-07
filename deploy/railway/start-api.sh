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

echo "=== Starting Node server ==="
exec node --trace-warnings packages/api/dist/server.js
