# WalkTogether Club dashboard (`club-admin/`)

Where club owners, admins and organisers manage their club: members, events and attendance, shared activities, challenges, announcements, analytics, subscription and settings — plus the sponsor portal.

Next.js 15 (App Router), Tailwind, `@walktogether/ui`. **Hosted on its own** (`clubs.walktogether.app`).
See [`../docs/deployment/HOSTING.md`](../docs/deployment/HOSTING.md).

## Layout

```
app/
  (auth)/login, (auth)/signup
  dashboard/          club picker (page.tsx), new/ (create a club)
    overview/ members/ (+ invitations/, roles/) events/ (+ [eventId]/) activities/
    challenges/ attendance/ announcements/ analytics/ subscription/ settings/
    moderation/ sponsorships/
  sponsor/            sponsor portal
components/           top bar, auth shell, RequireAuth
features/             auth, billing, clubs (use-club: active club from ?club=<id>)
lib/                  api client, auth, errors, download
```

## Run locally

Start the API first (see `server/README.md`), then:

```bash
cp club-admin/.env.example club-admin/.env.local
```

```bash
pnpm --filter @walktogether/club-admin dev
```

Open <http://localhost:3001>.

## Configuration

Variables (see [`.env.example`](.env.example)): `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_MEDIA_UPLOAD_ORIGIN`.
`NEXT_PUBLIC_*` values are inlined at **build time** — set them per environment before building.
The managed club is part of the URL (`/dashboard/members?club=<id>`); the API checks the signed-in user's permissions in that club on every request. Old `/clubs/...` URLs redirect.

## Deploy

**Vercel:** create a project with *Root Directory* `club-admin`. [`vercel.json`](vercel.json) installs
only this app's dependencies and skips builds when neither this folder nor `packages/` changed.
Attach a custom domain on the same parent domain as the API.

**Container:** from the repository root —

```bash
docker build -f club-admin/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.walktogether.app -t walktogether-club-admin .
```

The image runs the standalone Next.js server on port 3000 as a non-root user.

**Plain Node:** `pnpm install --frozen-lockfile --filter @walktogether/club-admin...`, then
`pnpm --filter @walktogether/club-admin build` and `pnpm --filter @walktogether/club-admin start`.

## Test

```bash
pnpm --filter @walktogether/club-admin test
```

CI: `.github/workflows/club-admin.yml` (typecheck, tests, build, Docker image) runs when this folder or
`packages/` changes.
