# syntax=docker/dockerfile:1.7
# WalkTogether API + worker image. Build from the repository root:
#   docker build -f infrastructure/docker/server.Dockerfile -t walktogether-api .
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CHECKPOINT_DISABLE=1 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY server/package.json server/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/validation/package.json packages/validation/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @walktogether/server...
COPY packages/shared-types packages/shared-types
COPY packages/validation packages/validation
COPY server server
RUN pnpm --filter @walktogether/server exec prisma generate && pnpm --filter @walktogether/server build
RUN pnpm --filter @walktogether/server deploy --prod --legacy /out && cp -r server/dist server/prisma /out/ \
  && cd /out && npx prisma generate --schema prisma/schema.prisma

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production CHECKPOINT_DISABLE=1
WORKDIR /app
COPY --from=build --chown=node:node /out /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:4000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
# Override with ["node", "dist/worker.js"] for the background worker,
# or ["npx", "prisma", "migrate", "deploy"] for the migration job.
CMD ["node", "dist/main.js"]
