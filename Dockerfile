# syntax=docker/dockerfile:1

# --------------------------------------------------------------------------
# XTerminal production image
# --------------------------------------------------------------------------
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME="/pnpm" \
    PATH="$PNPM_HOME:$PATH" \
    CI=1
# build-essential/python3: needed to compile ssh2's optional native crypto binding
RUN corepack enable \
    && apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# --------------------------------------------------------------------------
# Build stage: install all deps and build every workspace package
# --------------------------------------------------------------------------
FROM base AS build
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/types/package.json packages/types/
COPY packages/validation/package.json packages/validation/
COPY packages/crypto/package.json packages/crypto/
COPY packages/ui/package.json packages/ui/

# Lockfile is copied above, so installs are reproducible: the image gets the
# exact dependency versions the lockfile was tested with.
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY prisma ./prisma
COPY apps ./apps
COPY packages ./packages

RUN pnpm prisma generate && pnpm build

# --------------------------------------------------------------------------
# Production dependencies only (api + its workspace dependencies)
# --------------------------------------------------------------------------
FROM base AS prod-deps
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/types/package.json packages/types/
COPY packages/validation/package.json packages/validation/
COPY packages/crypto/package.json packages/crypto/
COPY packages/ui/package.json packages/ui/

RUN pnpm install --prod --frozen-lockfile

# --------------------------------------------------------------------------
# Runtime
# --------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r xterminal && useradd -r -g xterminal xterminal

COPY --from=prod-deps --chown=xterminal:xterminal /app/node_modules ./node_modules
COPY --from=prod-deps --chown=xterminal:xterminal /app/apps/api/node_modules ./apps/api/node_modules
# Workspace package manifests (package.json + exports maps) from prod-deps …
COPY --from=prod-deps --chown=xterminal:xterminal /app/packages ./packages
# … and their compiled dist/ from the build stage: the api imports
# @xterminal/{types,crypto,validation} through workspace symlinks that point
# into /app/packages, which only contains package.json files until now.
COPY --from=build --chown=xterminal:xterminal /app/packages/types/dist ./packages/types/dist
COPY --from=build --chown=xterminal:xterminal /app/packages/crypto/dist ./packages/crypto/dist
COPY --from=build --chown=xterminal:xterminal /app/packages/validation/dist ./packages/validation/dist
# The compiled api resolves the generated Prisma client relative to dist/
# (src/context.ts imports ./generated/prisma/index.js); tsc does not emit the
# generated .js files, so they are copied in next to the compiled output.
COPY --from=build --chown=xterminal:xterminal /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=xterminal:xterminal /app/apps/api/src/generated ./apps/api/dist/generated
COPY --from=build --chown=xterminal:xterminal /app/apps/web/dist ./apps/web/dist
COPY --chown=xterminal:xterminal prisma ./prisma
COPY --chown=xterminal:xterminal package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY --chown=xterminal:xterminal docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x docker/entrypoint.sh

USER xterminal
EXPOSE 7132

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
    CMD curl -fsS http://localhost:7132/health || exit 1

ENTRYPOINT ["./docker/entrypoint.sh"]
