# WalkTogether Public website (`website/`)

Marketing pages, pricing (live from the plans API), club discovery and club pages, public events, legal pages and email-link landing pages (verify email, reset password). Server-rendered for SEO; it only calls public API endpoints.

Next.js 15 (App Router), Tailwind, `@walktogether/ui`. **Hosted on its own** (`walktogether.app`).
See [`../docs/deployment/HOSTING.md`](../docs/deployment/HOSTING.md).

## Layout

```
app/
  page.tsx            home              pricing/   live plans
  clubs/              discovery + [slug] SEO pages
  events/             upcoming public events + [id] pages (schema.org SportsEvent)
  about/ contact/ features/ for-clubs/ for-organizations/ sponsors/ privacy/ terms/
  verify-email/ reset-password/      email-link landing pages
  sitemap.ts robots.ts
components/           header, footer, page header, feature grid
features/             auth (reset password form)
lib/                  api (server-side fetches), config, format
```

## Run locally

Start the API first (see `server/README.md`), then:

```bash
cp website/.env.example website/.env.local
```

```bash
pnpm --filter @walktogether/website dev
```

Open <http://localhost:3000>.

## Configuration

Variables (see [`.env.example`](.env.example)): `NEXT_PUBLIC_API_URL`, `API_INTERNAL_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_CLUB_ADMIN_URL`, `NEXT_PUBLIC_CONTACT_EMAIL`.
`NEXT_PUBLIC_*` values are inlined at **build time** — set them per environment before building.
`API_INTERNAL_URL` lets server-side rendering reach the API over a private network when both run on the same platform; otherwise set it to the public API URL.

## Deploy

**Vercel:** create a project with *Root Directory* `website`. [`vercel.json`](vercel.json) installs
only this app's dependencies and skips builds when neither this folder nor `packages/` changed.
Attach a custom domain on the same parent domain as the API.

**Container:** from the repository root —

```bash
docker build -f website/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.walktogether.app -t walktogether-website .
```

The image runs the standalone Next.js server on port 3000 as a non-root user.

**Plain Node:** `pnpm install --frozen-lockfile --filter @walktogether/website...`, then
`pnpm --filter @walktogether/website build` and `pnpm --filter @walktogether/website start`.

## Test

```bash
pnpm --filter @walktogether/website test
```

CI: `.github/workflows/website.yml` (typecheck, tests, build, Docker image) runs when this folder or
`packages/` changes.
