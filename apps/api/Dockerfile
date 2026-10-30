# -----------------------------------------------------------------------------
# Stage 1: Build
# -----------------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/contracts/package.json ./packages/contracts/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN npm ci

COPY packages/contracts ./packages/contracts
RUN npm run build:contracts

COPY apps/api ./apps/api
RUN npm run prisma:generate -w apps/api
RUN npm run build -w apps/api

# -----------------------------------------------------------------------------
# Stage 2: Production runner (non-root)
# -----------------------------------------------------------------------------
FROM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache openssl

# Explicit non-root user nodejs:nodejs (UID 1001)
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nodejs

ENV NODE_ENV=production
ENV PORT=3001

COPY --from=builder --chown=nodejs:nodejs /app/package.json /app/package-lock.json /app/tsconfig.base.json ./
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/packages/contracts ./packages/contracts
COPY --from=builder --chown=nodejs:nodejs /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder --chown=nodejs:nodejs /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=nodejs:nodejs /app/apps/api/prisma ./apps/api/prisma

USER nodejs

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=5s \
  CMD node -e "fetch('http://localhost:3001/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["sh", "-c", "npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma && node apps/api/dist/main.js"]
