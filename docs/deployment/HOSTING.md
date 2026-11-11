# Hosting map

WalkTogether is one repository with **three independently deployed applications** — one backend and
two frontends — sharing a single PostgreSQL database **through the backend only**. Each application
folder has its own `README.md`, `.env.example`, build/start commands, Dockerfile (or EAS config) and
CI workflow, so it can be hosted on its own schedule.

| Folder | What it is | Who uses it | Recommended host | Domain (example) | Deploy artifact | CI workflow |
| --- | --- | --- | --- | --- | --- | --- |
| `server/` | REST + Socket.IO API, background worker, migrations; also email-link and legal pages | everything | Container platform (ECS Fargate, Fly.io, Render, Railway, a VM) | `api.walktogether.app` | `server/Dockerfile` (one image, three roles) | `server.yml` |
| `mobile/` | Android & iOS app — members **and** club owners, admins, organisers, moderators | all members | EAS Build → Google Play / App Store | — | `mobile/eas.json` | `mobile.yml` |
| `platform-admin/` | The only web app: platform-level administration | WalkTogether staff | Vercel (`platform-admin/vercel.json`) or container, **behind an IP allow-list / VPN** | `admin.walktogether.app` | `platform-admin/Dockerfile` | `platform-admin.yml` |

There is deliberately **no public marketing website** and **no club-admin web app**. Links that open
outside the app are served by the API:

| URL on the API host | Purpose |
| --- | --- |
| `/links/verify-email?token=` | Confirms an email address, then offers "Open WalkTogether" |
| `/links/reset-password?token=` | Minimal password-reset form (CSP-protected, rate-limited) |
| `/links/invite/<code>` | Opens the club in the app (`walktogether://clubs/<slug>?invite=<code>`) and shows the code |
| `/links/payment?result=success|cancelled` | Stripe Checkout return page (never confirms payments itself) |
| `/legal/privacy`, `/legal/terms` | Privacy policy and terms — give these URLs to Google Play and the App Store |

Shared, non-deployed code lives in `packages/` and is compiled into each application at build time:

| Package | Used by |
| --- | --- |
| `shared-types`, `validation`, `shared-utils` (formatting + GPS engine) | server, mobile, platform-admin |
| `api-client` | mobile, platform-admin |

A change in `packages/` triggers CI (and Vercel builds) for every application that uses it.
`.github/workflows/ci.yml` runs repository-wide checks (typecheck, shared package tests, dependency
audit, secret scan) on every push.

## Platform admin and the API: one parent domain

The platform admin signs in with an httpOnly, `SameSite=Strict` refresh cookie set by the API. Browsers
send it only when the web app and the API are on the **same site** (same registrable domain):

* ✅ `admin.walktogether.app` → `api.walktogether.app`
* ❌ `walktogether-admin.vercel.app` → `walktogether-api.onrender.com` (sign-in silently fails)

The API logs a warning at start-up for any `CORS_ORIGINS` entry that breaks this rule and refuses to
start in staging/production if an origin or `API_PUBLIC_URL` is not `https://`. The mobile app is not
a browser origin and is unaffected (tokens live in the device keychain).

## Build context

Dockerfiles are built from the **repository root**, because each application compiles `packages/`:

```bash
docker build -f server/Dockerfile -t walktogether-api .
```

```bash
docker build -f platform-admin/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.walktogether.app -t walktogether-platform-admin .
```

On Vercel, create one project for the platform admin with *Root Directory* `platform-admin`; its
`vercel.json` installs only that app's dependencies and skips builds when neither the app nor
`packages/` changed. Mobile builds run on EAS from the `mobile/` folder.

## Wiring

| Setting | Where | Value |
| --- | --- | --- |
| `API_PUBLIC_URL` | server | the API's own public URL — email links, invitation links, Stripe returns, M-Pesa/Stripe callbacks and legal pages are built from it |
| `CORS_ORIGINS` | server | the platform admin origin, e.g. `https://admin.walktogether.app` |
| `SUPPORT_EMAIL` | server | contact address on the legal pages |
| `NEXT_PUBLIC_API_URL` | platform-admin (build time) | API URL |
| `EXPO_PUBLIC_API_URL` | mobile (`eas.json` per profile) | API URL |

## Release order

1. Back up the database, then run the migration job (`npx prisma migrate deploy` with the API image).
2. Deploy the **worker**, then the **API** (health check `GET /health/ready`).
3. Deploy the platform admin.
4. Mobile releases go through store review; the API must keep supporting the previous app version
   (the API is versioned under `/api/v1` and changed backwards-compatibly).

See [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md) for the reference AWS topology, backups and the
production checklist.
