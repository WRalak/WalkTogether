# Infrastructure

Operational files that are not part of any single deployable unit. Each unit's own build files live
next to its code (`server/Dockerfile`, `apps/*/Dockerfile`, `apps/*/vercel.json`, `apps/mobile/eas.json`).

| Path | Purpose |
| --- | --- |
| `docker/postgres-init.sql` | Enables PostGIS/pg_trgm and creates the test database for local `docker compose` |
| `nginx/walktogether.conf` | Reverse-proxy config for self-hosting several units on one VM (TLS, WebSockets, rate limits) |
| `deployment/backup.sh` | Encrypted `pg_dump` to S3 (schedule it, e.g. nightly) |
| `deployment/restore-drill.sh` | Restores the latest backup into a scratch database and verifies it |

The hosting map for every unit is in [`../docs/deployment/HOSTING.md`](../docs/deployment/HOSTING.md).
