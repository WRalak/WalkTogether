# Hosting map

WalkTogether is one repository with **five independently deployed units**. Each folder below has its
own `README.md`, `.env.example`, build/start commands, Dockerfile (or EAS config) and CI workflow, so
it can live on a different host and ship on its own schedule.

| Folder | What it is | Recommended host | Domain (example) | Deploy artifact | CI workflow |
| --- | --- | --- | --- | --- | --- |
| `server/` | REST + Socket.IO API, background worker, migrations | Container platform (ECS Fargate, Fly.io, Render, Railway, a VM) | `api.walktogether.app` | `server/Dockerfile` (one image, three roles) | `server.yml` |
| `apps/website/` | Public marketing site, club & event SEO pages | Vercel (`apps/website/vercel.json`) or any container host | `walktogether.app` | `apps/website/Dockerfile` | `website.yml` |
| `apps/club-admin/` | Club management dashboard | Vercel or container host | `clubs.walktogether.app` | `apps/club-admin/Dockerfile` | `club-admin.yml` |
| `apps/platform-admin/` | Platform super-admin (MFA) | Vercel or container host, **behind an IP allow-list / VPN** | `admin.walktogether.app` | `apps/platform-admin/Dockerfile` | `platform-admin.yml` |
| `apps/mobile/` | Android & iOS app | EAS Build → Google Play / App Store | — | `apps/mobile/eas.json` | `mobile.yml` |

Shared, non-deployed code lives in `packages/` and is compiled into each unit at build time:

| Package | Used by |
| --- | --- |
| `shared-types`, `validation`, `shared-utils` | everything |
| `api-client` | website, club-admin, platform-admin, mobile |
| `ui`, `configuration` | website, club-admin, platform-admin |
| `gps` | server, mobile |

A change in `packages/` therefore triggers CI (and Vercel builds) for every unit that uses it.
`.github/workflows/ci.yml` runs repository-wide checks (typecheck, shared package tests, dependency
audit, secret scan) on every push.

## The one hard rule: one parent domain

Web sign-in uses an httpOnly, `SameSite=Strict` refresh cookie set by the API. Browsers send it only
when the web app and the API are on the **same site** (same registrable domain):

* ✅ `clubs.walktogether.app` → `api.walktogether.app`
* ❌ `walktogether-clubs.vercel.app` → `walktogether-api.onrender.com` (sign-in silently fails)

So attach custom subdomains of one domain to every host, even when the hosts are different
companies. The API logs a warning at start-up for any `CORS_ORIGINS` entry that breaks this rule, and
refuses to start in staging/production if an origin or `API_PUBLIC_URL` is not `https://`.
The mobile app is unaffected (it stores tokens in the device keychain).

## Build context

Every Dockerfile is built from the **repository root**, because each unit compiles shared code from
`packages/`:

```bash
docker build -f server/Dockerfile -t walktogether-api .
```

```bash
docker build -f apps/website/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.walktogether.app --build-arg NEXT_PUBLIC_SITE_URL=https://walktogether.app --build-arg NEXT_PUBLIC_CLUB_ADMIN_URL=https://clubs.walktogether.app -t walktogether-website .
```

On a host that asks for a "root directory" and a "Dockerfile path", use root directory `/` (repository
root) and Dockerfile path `server/Dockerfile`, `apps/website/Dockerfile`, etc.

On **Vercel**, create one project per web app with *Root Directory* set to `apps/website`,
`apps/club-admin` or `apps/platform-admin`; the `vercel.json` in each folder installs only that app's
dependencies and skips the build when neither the app nor `packages/` changed.

## Wiring the units together

| Setting | Where | Value |
| --- | --- | --- |
| `CORS_ORIGINS` | server | every web app origin, comma-separated |
| `PUBLIC_WEB_URL` | server | website URL (links in emails) |
| `API_PUBLIC_URL` | server | the API's own public URL (M-Pesa/Stripe callbacks) |
| `NEXT_PUBLIC_API_URL` | each web app (build time) | API URL |
| `API_INTERNAL_URL` | website (runtime) | private API address when co-located, else the public URL |
| `NEXT_PUBLIC_CLUB_ADMIN_URL` | website | club dashboard URL |
| `NEXT_PUBLIC_MEDIA_UPLOAD_ORIGIN` | club-admin | S3/R2 bucket origin for direct uploads |
| `EXPO_PUBLIC_API_URL` | mobile (`eas.json` per profile) | API URL |

## Release order

1. Back up the database, then run the migration job (`npx prisma migrate deploy` with the API image).
2. Deploy the **worker**, then the **API** (health check `GET /health/ready`).
3. Deploy web apps in any order — they only depend on the API's public contract, which is versioned
   (`/api/v1`) and changed backwards-compatibly.
4. Mobile releases go through store review; the API must keep supporting the previous app version.

See [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md) for the reference AWS topology, backups and the
production checklist.
