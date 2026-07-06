# syntax=docker/dockerfile:1

# ---- deps: full install (dev + prod), needed to type-check and build ----
FROM node:20-alpine AS deps
# argon2 ships no prebuilt binary for musl (Alpine's libc), so npm falls back
# to compiling it from source on install — a C toolchain is required for that.
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: compile TypeScript to dist/ ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- prod-deps: production-only node_modules (same musl caveat as above) ----
FROM node:20-alpine AS prod-deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- production: minimal runtime image ----
FROM node:20-alpine AS production
ENV NODE_ENV=production
WORKDIR /app

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
COPY --from=builder --chown=node:node /app/drizzle.config.ts ./drizzle.config.ts
COPY --chown=node:node package.json ./

USER node

EXPOSE 3333

CMD ["node", "dist/src/main.js"]
