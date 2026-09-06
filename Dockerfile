# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- Dev stage (hot-reload; source is bind-mounted at runtime, node_modules kept) ----
FROM node:24-alpine AS dev
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
CMD ["npm", "run", "start:dev"]

# ---- Runtime stage ----
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Run as the built-in non-root user.
USER node
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/package.json ./package.json
EXPOSE 3000
# NOTE: health path must match API_PREFIX/API_VERSION (defaults in src/config/env.validation.ts);
# the k8s probes and docker-compose healthcheck hardcode the same path.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q --spider "http://127.0.0.1:${PORT:-3000}/api/v1/health/live" || exit 1
CMD ["node", "dist/main"]
