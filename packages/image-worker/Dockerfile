FROM node:22-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --ignore-engines

COPY . .
RUN yarn build

FROM node:22-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --production --ignore-engines

FROM node:22-alpine

RUN addgroup -g 1001 -S gryt \
  && adduser -S gryt -u 1001 -G gryt -h /app -s /sbin/nologin

WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps --chown=gryt:gryt /app/node_modules ./node_modules
COPY --from=builder --chown=gryt:gryt /app/package.json ./package.json
COPY --from=builder --chown=gryt:gryt /app/dist ./dist

USER gryt
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/ || exit 1

CMD ["node", "dist/index.js"]
