# ==========================================
# SafeSchool Multi-Target Dockerfile
# ==========================================
# Usage (set BUILD_TARGET as Railway build variable):
#   API (default):  BUILD_TARGET=api
#   Web:            BUILD_TARGET=web
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
# Build: Web (Next.js marketing site)
# ==========================================
FROM base AS build-web
ARG NEXT_PUBLIC_SITE_URL=https://safeschool.org
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
RUN cd apps/web && npm run build

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
COPY --from=build-api /app/node_modules ./node_modules
COPY --from=build-api /app/package.json ./

# Build-time module test
RUN node -e "require('@safeschool/db'); require('@safeschool/core'); require('fastify'); console.log('Modules OK')"

# Copy startup script
COPY deploy/railway/start-api.sh /app/start.sh
RUN sed -i 's/\r$//' /app/start.sh && chmod +x /app/start.sh

EXPOSE 3000
CMD ["/app/start.sh"]

# ==========================================
# Runner: Web (Next.js standalone)
# ==========================================
FROM node:20-alpine AS runner-web
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Next.js standalone output (includes minimal node_modules)
COPY --from=build-web /app/apps/web/.next/standalone ./
# Static assets (CSS, JS bundles)
COPY --from=build-web /app/apps/web/.next/static ./apps/web/.next/static

EXPOSE 3000
CMD ["node", "apps/web/server.js"]

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
COPY --from=build-api /app/node_modules ./node_modules
COPY --from=build-api /app/package.json ./

EXPOSE 3000
CMD ["node", "packages/api/dist/worker-entry.js"]

# ==========================================
# Runner: Dashboard (nginx serving Vite SPA)
# ==========================================
FROM nginx:alpine AS runner-dashboard

COPY --from=build-dashboard /app/apps/dashboard/dist /usr/share/nginx/html
COPY deploy/railway/nginx-spa.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]

# ==========================================
# Final: Select target based on BUILD_TARGET arg
# ==========================================
FROM runner-${BUILD_TARGET} AS final
