# syntax=docker/dockerfile:1.7
# WalkTogether platform super-admin (admin.) — standalone Next.js server.
#
# Build from the REPOSITORY ROOT (the app imports shared code from packages/):
#   docker build -f platform-admin/Dockerfile -t walktogether-platform-admin .
# NEXT_PUBLIC_* values are inlined at build time, so pass them as --build-arg per environment.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
ARG NEXT_PUBLIC_API_URL
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY packages packages
COPY platform-admin platform-admin
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @walktogether/platform-admin...
RUN pnpm --filter @walktogether/platform-admin build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/platform-admin/.next/standalone ./
COPY --from=build --chown=node:node /repo/platform-admin/.next/static ./platform-admin/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "platform-admin/server.js"]
