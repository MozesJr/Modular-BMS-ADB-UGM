FROM node:20-alpine AS base
WORKDIR /app
# Prisma query engine butuh libssl di Alpine, tanpa ini gagal saat runtime
RUN apk add --no-cache openssl

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# Hanya dependency produksi: tanpa prisma CLI, typescript, tsx, vitest, eslint.
# Prisma Client hasil generate (node_modules/.prisma) disalin dari stage builder.
FROM base AS prod-deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Image alat migrasi (butuh prisma CLI). TIDAK dijalankan otomatis oleh `docker compose up`
# (service backend-migrate ada di profile "tools"):
#   docker compose run --rm backend-migrate
FROM builder AS migrator
CMD ["npx", "prisma", "migrate", "deploy"]

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=4000
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/next.config.js ./next.config.js
COPY --from=builder --chown=node:node /app/dist ./dist

# Jangan jalan sebagai root. (Sinyal SIGTERM ditangani server.ts; compose memakai `init: true`.)
USER node

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -q --spider "http://127.0.0.1:${PORT}/api/health" || exit 1
CMD ["node", "dist/server.js"]
