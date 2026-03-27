# ---- Base ----
FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./

# ---- Dev (hot-reload with ts-node-dev) ----
FROM base AS dev
RUN npm install
COPY tsconfig.json ./
# src/ is volume-mounted in docker-compose for hot-reload
EXPOSE 3001
CMD ["npx", "ts-node-dev", "--respawn", "--transpile-only", "src/server.ts"]

# ---- Build ----
FROM base AS build
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# ---- Production ----
FROM node:20-alpine AS prod
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3001
CMD ["node", "dist/server.js"]
