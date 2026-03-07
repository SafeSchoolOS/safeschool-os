# EdgeRuntime Cloud Mode - Lighter image for Railway/cloud deployment
# Same codebase, OPERATING_MODE=CLOUD skips SQLite offline queue

FROM node:20-slim AS builder

# Install build tools for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Authenticate with GitHub Packages for @bwattendorf/adapters
ARG NODE_AUTH_TOKEN
ENV NODE_AUTH_TOKEN=${NODE_AUTH_TOKEN}
COPY .npmrc ./

COPY package.json package-lock.json* ./
COPY packages/core/package.json packages/core/
COPY packages/activation/package.json packages/activation/
COPY packages/sync-engine/package.json packages/sync-engine/
COPY packages/module-loader/package.json packages/module-loader/
COPY packages/connector-framework/package.json packages/connector-framework/
COPY packages/runtime/package.json packages/runtime/
COPY packages/cloud-sync/package.json packages/cloud-sync/
COPY modules/badgekiosk/package.json modules/badgekiosk/
COPY modules/access-gsoc/package.json modules/access-gsoc/
COPY modules/safeschool/package.json modules/safeschool/
COPY tools/keygen/package.json tools/keygen/

# Install ALL dependencies (dev needed for build step, scripts needed for better-sqlite3)
RUN npm ci

COPY tsconfig.base.json turbo.json ./
COPY packages/core/ packages/core/
COPY packages/activation/ packages/activation/
COPY packages/sync-engine/ packages/sync-engine/
COPY packages/module-loader/ packages/module-loader/
COPY packages/connector-framework/ packages/connector-framework/
COPY packages/runtime/ packages/runtime/
COPY packages/cloud-sync/ packages/cloud-sync/
COPY modules/ modules/
COPY tools/ tools/

# Build then strip dev dependencies, caches, and source files
RUN npx turbo run build \
    && npm prune --omit=dev \
    && rm -rf .turbo node_modules/.cache \
    && find packages modules -type d -name src -exec rm -rf {} + 2>/dev/null; \
       find packages modules -name '*.ts' ! -name '*.d.ts' ! -path '*/dist/*' -delete 2>/dev/null; \
       find packages modules -name 'tsconfig*.json' -delete 2>/dev/null; \
       rm -rf turbo.json tsconfig.base.json; true

FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules/ ./node_modules/
COPY --from=builder /app/packages/ ./packages/
COPY --from=builder /app/modules/ ./modules/
COPY deploy/cloud/homepages/ ./homepages/

ENV NODE_ENV=production
ENV OPERATING_MODE=CLOUD
ENV EDGERUNTIME_API_PORT=8470

EXPOSE 8470

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:8470/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

ENTRYPOINT ["tini", "--"]
CMD ["node", "packages/runtime/dist/index.js"]
