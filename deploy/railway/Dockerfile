FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json turbo.json ./
COPY packages/ ./packages/
COPY apps/ ./apps/

RUN npm install
RUN npx prisma generate --schema=packages/db/prisma/schema.prisma
RUN npx turbo run build --filter=@safeschool/api --filter=@safeschool/core

FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV OPERATING_MODE=cloud

COPY --from=builder /app/packages/api/dist ./packages/api/dist
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/db/prisma ./packages/db/prisma
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "packages/api/dist/server.js"]
