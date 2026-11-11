# WalkTogether Platform admin (`platform-admin/`)

The **only web application** of WalkTogether, used exclusively by the platform owner's staff for
platform-level administration: approve, suspend and manage clubs; manage users; monitor subscriptions
and revenue; payments and refunds; sponsorships and competitions; platform-wide activity and events;
reports; moderation cases; settings, feature flags and administrator permissions. Club administration
is not here — it lives in the mobile app. Separate identity (admin accounts), separate JWT secret and
mandatory TOTP MFA; every action is audit-logged.

Next.js 15 (App Router), Tailwind, shadcn-style components in `components/ui`. **Hosted on its own** (`admin.walktogether.app`).
See [`../docs/deployment/HOSTING.md`](../docs/deployment/HOSTING.md).

## Layout

```
app/
  (auth)/login        password + TOTP MFA (enrolment forced on first sign-in)
  dashboard/
    overview/ clubs/ users/ subscriptions/ payments/ sponsorships/ (+ competitions/) events/
    analytics/ reports/ moderation/ settings/ audit-logs/ security/ system/ admins/
components/ui/        Button, Field, Input, Table, Badge… (Tailwind + Radix Slot)
styles/base.css       design tokens (CSS variables, light/dark)
tailwind.preset.cjs   Tailwind theme
features/             admin login, tables, status actions
lib/                  admin api client, auth, errors
```

## Run locally

Start the API first (see `server/README.md`), then:

```bash
cp platform-admin/.env.example platform-admin/.env.local
```

```bash
pnpm --filter @walktogether/platform-admin dev
```

Open <http://localhost:3002>.

## Configuration

Variables (see [`.env.example`](.env.example)): `NEXT_PUBLIC_API_URL`.
`NEXT_PUBLIC_*` values are inlined at **build time** — set them per environment before building.
Host it on its own hostname and restrict access at the edge (IP allow-list, VPN or a zero-trust proxy) in addition to password + MFA. Pages send `X-Robots-Tag: noindex`.

## Deploy

**Vercel:** create a project with *Root Directory* `platform-admin`. [`vercel.json`](vercel.json) installs
only this app's dependencies and skips builds when neither this folder nor `packages/` changed.
Attach a custom domain on the same parent domain as the API.

**Container:** from the repository root —

```bash
docker build -f platform-admin/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.walktogether.app -t walktogether-platform-admin .
```

The image runs the standalone Next.js server on port 3000 as a non-root user.

**Plain Node:** `pnpm install --frozen-lockfile --filter @walktogether/platform-admin...`, then
`pnpm --filter @walktogether/platform-admin build` and `pnpm --filter @walktogether/platform-admin start`.

## Test

```bash
pnpm --filter @walktogether/platform-admin test
```

CI: `.github/workflows/platform-admin.yml` (typecheck, tests, build, Docker image) runs when this folder or
`packages/` changes.
