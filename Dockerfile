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
COPY package.json turbo.json tsconfig.json .npmrc ./
COPY packages/ ./packages/
COPY apps/ ./apps/

# Authenticate with GitHub Packages for @bwattendorf/adapters
ARG NODE_AUTH_TOKEN
RUN echo "//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}" >> .npmrc

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
COPY --from=build-api /app/node_modules ./node_modules
COPY --from=build-api /app/package.json ./

# Create non-root user and data directories
RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
  && mkdir -p /app/data/students \
  && chown -R appuser:appgroup /app

# Build-time module test (adapters now come from @bwattendorf/adapters in node_modules)
RUN node -e "require('@safeschool/db'); require('@safeschool/core'); require('fastify'); console.log('Modules OK')"

# Copy startup script
COPY deploy/railway/start-api.sh /app/start.sh
RUN sed -i 's/\r$//' /app/start.sh && chmod +x /app/start.sh

USER appuser
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
COPY --from=build-api /app/node_modules ./node_modules
COPY --from=build-api /app/package.json ./

RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
  && chown -R appuser:appgroup /app

USER appuser
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

RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
  && chown -R appuser:appgroup /app

USER appuser
EXPOSE 3000
CMD ["node", "serve-dashboard.js"]

# ==========================================
# Final: Select target based on BUILD_TARGET arg
# ==========================================
FROM runner-${BUILD_TARGET} AS final
