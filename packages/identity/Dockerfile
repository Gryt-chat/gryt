FROM oven/bun:1-alpine AS builder
WORKDIR /app

COPY package.json bun.lockb* ./
RUN bun install --no-save

COPY . .
RUN bun run build

FROM oven/bun:1-alpine

RUN addgroup -g 1001 -S gryt \
  && adduser -S gryt -u 1001 -G gryt -h /app -s /sbin/nologin

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder --chown=gryt:gryt /app/node_modules ./node_modules
COPY --from=builder --chown=gryt:gryt /app/package.json ./package.json
COPY --from=builder --chown=gryt:gryt /app/dist ./dist

RUN mkdir -p /app/data && chown gryt:gryt /app/data

USER gryt
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["bun", "dist/index.js"]
