# AgentFoundry — single-image deployment.
# One Node service serves the HTTP API and the built web console on one port
# (see backend/src/bin-serve.ts). Multi-stage: build the web bundle, install the
# backend, then run a slim runtime image.

# ---- Stage 1: build the web console ----
FROM node:22-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build

# ---- Stage 2: install backend deps ----
FROM node:22-slim AS backend
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json* ./
RUN npm install
COPY backend/ ./

# ---- Stage 3: runtime ----
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Backend (source + node_modules incl. tsx) and the built web bundle.
COPY --from=backend /app/backend /app/backend
COPY --from=web /app/web/dist /app/web/dist
# The server serves the web bundle from AF_WEB_DIST.
ENV AF_WEB_DIST=/app/web/dist
ENV PORT=8080
# Durable storage lives on a mounted volume so credentials/audit survive restarts.
ENV AF_DATA=/data
VOLUME ["/data"]
EXPOSE 8080
WORKDIR /app/backend
CMD ["npm", "run", "serve"]
