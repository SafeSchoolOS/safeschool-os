# ==========================================
# SafeSchool Multi-Target Dockerfile
# ==========================================
# Usage (set BUILD_TARGET as Railway build variable):
#   API (default):  BUILD_TARGET=api
#   Dashboard:      BUILD_TARGET=dashboard
#   Worker:         BUILD_TARGET=worker
# ==========================================

ARG BUILD_TARGET=api

# ==========================================
# Base: Install all workspace dependencies
# ==========================================
FROM node:20-alpine AS base
WORKDIR /app
COPY package.json turbo.json tsconfig.json ./
COPY packages/ ./packages/
COPY apps/ ./apps/
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npm install --legacy-peer-deps
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate --schema=packages/db/prisma/schema.prisma

# ==========================================
# Build: API + all backend packages
# ==========================================
FROM base AS build-api
RUN npx turbo run build --filter='./packages/**'

# ==========================================
# Build: Dashboard (Vite + React SPA)
# ==========================================
FROM base AS build-dashboard
ARG VITE_API_URL
ARG VITE_AUTH_PROVIDER=dev
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_AUTH_PROVIDER=$VITE_AUTH_PROVIDER
RUN npx turbo run build --filter=@safeschool/dashboard

# ==========================================
# Runner: API
# ==========================================
FROM node:20-alpine AS runner-api
WORKDIR /app
ENV NODE_ENV=production
ENV OPERATING_MODE=cloud

# Copy all workspace packages (dist + package.json for Node module resolution)
COPY --from=build-api /app/packages/api/dist ./packages/api/dist
COPY --from=build-api /app/packages/api/package.json ./packages/api/package.json
COPY --from=build-api /app/packages/core/dist ./packages/core/dist
COPY --from=build-api /app/packages/core/package.json ./packages/core/package.json
COPY --from=build-api /app/packages/db/dist ./packages/db/dist
COPY --from=build-api /app/packages/db/package.json ./packages/db/package.json
COPY --from=build-api /app/packages/db/prisma ./packages/db/prisma
COPY --from=build-api /app/packages/edge/dist ./packages/edge/dist
COPY --from=build-api /app/packages/edge/package.json ./packages/edge/package.json
COPY --from=build-api /app/packages/integrations/access-control/dist ./packages/integrations/access-control/dist
COPY --from=build-api /app/packages/integrations/access-control/package.json ./packages/integrations/access-control/package.json
COPY --from=build-api /app/packages/integrations/dispatch/dist ./packages/integrations/dispatch/dist
COPY --from=build-api /app/packages/integrations/dispatch/package.json ./packages/integrations/dispatch/package.json
COPY --from=build-api /app/packages/integrations/notifications/dist ./packages/integrations/notifications/dist
COPY --from=build-api /app/packages/integrations/notifications/package.json ./packages/integrations/notifications/package.json
COPY --from=build-api /app/packages/integrations/visitor-mgmt/dist ./packages/integrations/visitor-mgmt/dist
COPY --from=build-api /app/packages/integrations/visitor-mgmt/package.json ./packages/integrations/visitor-mgmt/package.json
COPY --from=build-api /app/packages/integrations/transportation/dist ./packages/integrations/transportation/dist
COPY --from=build-api /app/packages/integrations/transportation/package.json ./packages/integrations/transportation/package.json
COPY --from=build-api /app/packages/integrations/grants/dist ./packages/integrations/grants/dist
COPY --from=build-api /app/packages/integrations/grants/package.json ./packages/integrations/grants/package.json
COPY --from=build-api /app/packages/integrations/cameras/dist ./packages/integrations/cameras/dist
COPY --from=build-api /app/packages/integrations/cameras/package.json ./packages/integrations/cameras/package.json
COPY --from=build-api /app/packages/integrations/threat-intel/dist ./packages/integrations/threat-intel/dist
COPY --from=build-api /app/packages/integrations/threat-intel/package.json ./packages/integrations/threat-intel/package.json
COPY --from=build-api /app/packages/integrations/environmental/dist ./packages/integrations/environmental/dist
COPY --from=build-api /app/packages/integrations/environmental/package.json ./packages/integrations/environmental/package.json
COPY --from=build-api /app/packages/integrations/threat-assessment/dist ./packages/integrations/threat-assessment/dist
COPY --from=build-api /app/packages/integrations/threat-assessment/package.json ./packages/integrations/threat-assessment/package.json
COPY --from=build-api /app/packages/integrations/social-media/dist ./packages/integrations/social-media/dist
COPY --from=build-api /app/packages/integrations/social-media/package.json ./packages/integrations/social-media/package.json
COPY --from=build-api /app/packages/integrations/panic-devices/dist ./packages/integrations/panic-devices/dist
COPY --from=build-api /app/packages/integrations/panic-devices/package.json ./packages/integrations/panic-devices/package.json
COPY --from=build-api /app/packages/integrations/gunshot-detection/dist ./packages/integrations/gunshot-detection/dist
COPY --from=build-api /app/packages/integrations/gunshot-detection/package.json ./packages/integrations/gunshot-detection/package.json
COPY --from=build-api /app/packages/integrations/weather/dist ./packages/integrations/weather/dist
COPY --from=build-api /app/packages/integrations/weather/package.json ./packages/integrations/weather/package.json
COPY --from=build-api /app/packages/integrations/badge-printing/dist ./packages/integrations/badge-printing/dist
COPY --from=build-api /app/packages/integrations/badge-printing/package.json ./packages/integrations/badge-printing/package.json
COPY --from=build-api /app/node_modules ./node_modules
COPY --from=build-api /app/package.json ./

# Create data directories
RUN mkdir -p /app/data/students

# Build-time module test
RUN node -e "require('@safeschool/db'); require('@safeschool/core'); require('@safeschool/weather'); require('fastify'); console.log('Modules OK')"

# Copy startup script
COPY deploy/railway/start-api.sh /app/start.sh
RUN sed -i 's/\r$//' /app/start.sh && chmod +x /app/start.sh

EXPOSE 3000
CMD ["/app/start.sh"]

# ==========================================
# Runner: Worker (same packages as API, different entrypoint)
# ==========================================
FROM node:20-alpine AS runner-worker
WORKDIR /app
ENV NODE_ENV=production
ENV OPERATING_MODE=cloud

COPY --from=build-api /app/packages/api/dist ./packages/api/dist
COPY --from=build-api /app/packages/api/package.json ./packages/api/package.json
COPY --from=build-api /app/packages/core/dist ./packages/core/dist
COPY --from=build-api /app/packages/core/package.json ./packages/core/package.json
COPY --from=build-api /app/packages/db/dist ./packages/db/dist
COPY --from=build-api /app/packages/db/package.json ./packages/db/package.json
COPY --from=build-api /app/packages/db/prisma ./packages/db/prisma
COPY --from=build-api /app/packages/edge/dist ./packages/edge/dist
COPY --from=build-api /app/packages/edge/package.json ./packages/edge/package.json
COPY --from=build-api /app/packages/integrations/access-control/dist ./packages/integrations/access-control/dist
COPY --from=build-api /app/packages/integrations/access-control/package.json ./packages/integrations/access-control/package.json
COPY --from=build-api /app/packages/integrations/dispatch/dist ./packages/integrations/dispatch/dist
COPY --from=build-api /app/packages/integrations/dispatch/package.json ./packages/integrations/dispatch/package.json
COPY --from=build-api /app/packages/integrations/notifications/dist ./packages/integrations/notifications/dist
COPY --from=build-api /app/packages/integrations/notifications/package.json ./packages/integrations/notifications/package.json
COPY --from=build-api /app/packages/integrations/visitor-mgmt/dist ./packages/integrations/visitor-mgmt/dist
COPY --from=build-api /app/packages/integrations/visitor-mgmt/package.json ./packages/integrations/visitor-mgmt/package.json
COPY --from=build-api /app/packages/integrations/transportation/dist ./packages/integrations/transportation/dist
COPY --from=build-api /app/packages/integrations/transportation/package.json ./packages/integrations/transportation/package.json
COPY --from=build-api /app/packages/integrations/grants/dist ./packages/integrations/grants/dist
COPY --from=build-api /app/packages/integrations/grants/package.json ./packages/integrations/grants/package.json
COPY --from=build-api /app/packages/integrations/cameras/dist ./packages/integrations/cameras/dist
COPY --from=build-api /app/packages/integrations/cameras/package.json ./packages/integrations/cameras/package.json
COPY --from=build-api /app/packages/integrations/threat-intel/dist ./packages/integrations/threat-intel/dist
COPY --from=build-api /app/packages/integrations/threat-intel/package.json ./packages/integrations/threat-intel/package.json
COPY --from=build-api /app/packages/integrations/environmental/dist ./packages/integrations/environmental/dist
COPY --from=build-api /app/packages/integrations/environmental/package.json ./packages/integrations/environmental/package.json
COPY --from=build-api /app/packages/integrations/threat-assessment/dist ./packages/integrations/threat-assessment/dist
COPY --from=build-api /app/packages/integrations/threat-assessment/package.json ./packages/integrations/threat-assessment/package.json
COPY --from=build-api /app/packages/integrations/social-media/dist ./packages/integrations/social-media/dist
COPY --from=build-api /app/packages/integrations/social-media/package.json ./packages/integrations/social-media/package.json
COPY --from=build-api /app/packages/integrations/panic-devices/dist ./packages/integrations/panic-devices/dist
COPY --from=build-api /app/packages/integrations/panic-devices/package.json ./packages/integrations/panic-devices/package.json
COPY --from=build-api /app/packages/integrations/gunshot-detection/dist ./packages/integrations/gunshot-detection/dist
COPY --from=build-api /app/packages/integrations/gunshot-detection/package.json ./packages/integrations/gunshot-detection/package.json
COPY --from=build-api /app/packages/integrations/weather/dist ./packages/integrations/weather/dist
COPY --from=build-api /app/packages/integrations/weather/package.json ./packages/integrations/weather/package.json
COPY --from=build-api /app/packages/integrations/badge-printing/dist ./packages/integrations/badge-printing/dist
COPY --from=build-api /app/packages/integrations/badge-printing/package.json ./packages/integrations/badge-printing/package.json
COPY --from=build-api /app/node_modules ./node_modules
COPY --from=build-api /app/package.json ./

EXPOSE 3000
CMD ["node", "packages/api/dist/worker-entry.js"]

# ==========================================
# Runner: Dashboard (Node.js static server for Vite SPA)
# ==========================================
FROM node:20-alpine AS runner-dashboard
WORKDIR /app

COPY --from=build-dashboard /app/apps/dashboard/dist ./dist
COPY deploy/railway/serve-dashboard.js ./serve-dashboard.js

# Verify build output exists
RUN ls -la dist/ && test -f dist/index.html

EXPOSE 3000
CMD ["node", "serve-dashboard.js"]

# ==========================================
# Final: Select target based on BUILD_TARGET arg
# ==========================================
FROM runner-${BUILD_TARGET} AS final
