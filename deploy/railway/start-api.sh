#!/bin/sh
set -e

echo "=== Running migrations ==="
npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma
echo "=== Migration complete ==="

echo "=== Checking dist files ==="
ls -la packages/api/dist/server.js 2>&1 || echo "MISSING: packages/api/dist/server.js"
ls -la packages/db/dist/index.js 2>&1 || echo "MISSING: packages/db/dist/index.js"
ls -la node_modules/@safeschool/db 2>&1 || echo "MISSING: node_modules/@safeschool/db"

echo "=== Testing module imports ==="
node -e "try { require('@safeschool/db'); console.log('OK: @safeschool/db'); } catch(e) { console.error('FAIL @safeschool/db:', e.message); }"
node -e "try { require('@safeschool/core'); console.log('OK: @safeschool/core'); } catch(e) { console.error('FAIL @safeschool/core:', e.message); }"
node -e "try { require('@safeschool/dispatch'); console.log('OK: @safeschool/dispatch'); } catch(e) { console.error('FAIL @safeschool/dispatch:', e.message); }"

echo "=== Starting server ==="
exec node packages/api/dist/server.js
