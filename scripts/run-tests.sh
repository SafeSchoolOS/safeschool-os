#!/bin/bash
set -e

echo "=== SafeSchool Test Runner ==="
echo "DATABASE_URL: ${DATABASE_URL}"
echo "REDIS_URL: ${REDIS_URL}"
echo ""

# Sync database schema (db push is faster and better for testing than migrate deploy)
echo "--- Pushing Prisma schema to database ---"
npx prisma db push --schema=packages/db/prisma/schema.prisma --accept-data-loss

# Seed the database
echo "--- Seeding database ---"
npx tsx packages/db/src/seed.ts

echo ""
echo "--- Running all tests ---"
echo ""

# Run edge package tests (conflict-resolver, sync-engine, offline-queue)
echo "=== Edge Package Tests ==="
npx vitest run packages/edge/src/__tests__/ --reporter=verbose 2>&1
EDGE_EXIT=$?

# Run integrations tests (dispatch, cameras, threat-intel, etc.)
echo ""
echo "=== Integration Tests ==="
npx vitest run packages/integrations/ --reporter=verbose 2>&1
INTEGRATIONS_EXIT=$?

# Run API tests (routes, bugs)
# --fileParallelism=false prevents test files from running in parallel
# which is required because all test suites share the same database
# and cleanupTestData deletes ALL non-seed records across suites
echo ""
echo "=== API Tests ==="
OPERATING_MODE=edge npx vitest run packages/api/src/ --reporter=verbose --fileParallelism=false 2>&1
API_EXIT=$?

echo ""
echo "=== Test Summary ==="
echo "Edge:         $([ $EDGE_EXIT -eq 0 ] && echo 'PASSED' || echo 'FAILED')"
echo "Integrations: $([ $INTEGRATIONS_EXIT -eq 0 ] && echo 'PASSED' || echo 'FAILED')"
echo "API:          $([ $API_EXIT -eq 0 ] && echo 'PASSED' || echo 'FAILED')"

# Exit with failure if any suite failed
if [ $EDGE_EXIT -ne 0 ] || [ $INTEGRATIONS_EXIT -ne 0 ] || [ $API_EXIT -ne 0 ]; then
  echo ""
  echo "SOME TESTS FAILED"
  exit 1
fi

echo ""
echo "ALL TESTS PASSED"
exit 0
