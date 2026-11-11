# syntax=docker/dockerfile:1.7
# WalkTogether public website (www) — standalone Next.js server.
#
# Build from the REPOSITORY ROOT (the app imports shared code from packages/):
#   docker build -f apps/website/Dockerfile -t walktogether-website .
# NEXT_PUBLIC_* values are inlined at build time, so pass them as --build-arg per environment.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_CLUB_ADMIN_URL
ARG NEXT_PUBLIC_CONTACT_EMAIL
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY packages packages
COPY apps/website apps/website
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @walktogether/website...
RUN pnpm --filter @walktogether/website build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/website/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/website/.next/static ./apps/website/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/website/server.js"]
