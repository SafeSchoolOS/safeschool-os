# SafeSchoolOS Docker Image
# Open-source school safety platform powered by EdgeRuntime

FROM node:20-slim AS builder

# Install build tools for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/core/package.json packages/core/
COPY packages/activation/package.json packages/activation/
COPY packages/sync-engine/package.json packages/sync-engine/
COPY packages/module-loader/package.json packages/module-loader/
COPY packages/connector-framework/package.json packages/connector-framework/
COPY packages/runtime/package.json packages/runtime/
COPY packages/cloud-sync/package.json packages/cloud-sync/
COPY packages/setup-wizard/package.json packages/setup-wizard/
COPY modules/safeschool/package.json modules/safeschool/

# Install ALL dependencies (dev needed for build step, scripts needed for better-sqlite3)
RUN npm ci

# Copy source (only public packages and safeschool module)
COPY tsconfig.base.json turbo.json ./
COPY packages/core/ packages/core/
COPY packages/activation/ packages/activation/
COPY packages/sync-engine/ packages/sync-engine/
COPY packages/module-loader/ packages/module-loader/
COPY packages/connector-framework/ packages/connector-framework/
COPY packages/runtime/ packages/runtime/
COPY packages/cloud-sync/ packages/cloud-sync/
COPY packages/setup-wizard/ packages/setup-wizard/
COPY modules/safeschool/ modules/safeschool/

# Build then strip dev dependencies, caches, and source files
RUN npx turbo run build \
    && npm prune --omit=dev \
    && rm -rf .turbo node_modules/.cache \
    && find packages modules -type d -name src -exec rm -rf {} + 2>/dev/null; \
       find packages modules -name '*.ts' ! -name '*.d.ts' ! -path '*/dist/*' -delete 2>/dev/null; \
       find packages modules -name 'tsconfig*.json' -delete 2>/dev/null; \
       rm -rf turbo.json tsconfig.base.json; true

# ---------- Production image ----------
FROM node:20-slim AS runtime

ARG EDGERUNTIME_VERSION=dev
ENV EDGERUNTIME_VERSION=${EDGERUNTIME_VERSION}

RUN apt-get update && apt-get install -y --no-install-recommends \
    tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only production artifacts (no source .ts files)
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules/ ./node_modules/
COPY --from=builder /app/packages/ ./packages/
COPY --from=builder /app/modules/ ./modules/

# Data directory and install directory for setup wizard .env
RUN mkdir -p /app/data /opt/edgeruntime

# Entrypoint script (runs setup wizard on first boot if no activation key)
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENV NODE_ENV=production
ENV EDGERUNTIME_DATA_DIR=/app/data
ENV EDGERUNTIME_API_PORT=8470
ENV INSTALL_DIR=/opt/edgeruntime

EXPOSE 8470 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:8470/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

ENTRYPOINT ["tini", "--"]
CMD ["node", "packages/runtime/dist/index.js"]
