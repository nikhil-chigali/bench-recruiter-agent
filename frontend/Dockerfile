# Callup frontend — Vite SPA on Railway.
# Build context is the `frontend/` directory (set Root Directory = frontend on the
# Railway service).
#
# IMPORTANT: Vite inlines VITE_* variables at BUILD time, so they arrive as build
# ARGs (Railway passes the service's variables to the Docker build automatically).
# Changing any VITE_* value therefore requires a rebuild, not just a restart.

# ---------- build ----------
FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@11.5.3 --activate
WORKDIR /app

# Dependency layer — cached unless the lockfile/manifest changes. .npmrc carries the
# minimum-release-age policy; --frozen-lockfile skips re-resolution so it stays fast.
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY . .

# Build-time public config (no secrets — everything here ships in the JS bundle).
ARG VITE_API_BASE_URL
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN pnpm build

# ---------- serve ----------
# Caddy serves the static bundle and falls back to index.html for client-side
# routes (e.g. /accept-invite). Binds $PORT; Railway terminates TLS at the edge.
FROM caddy:2-alpine
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
