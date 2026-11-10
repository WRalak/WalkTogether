# Load testing

`loadtest/run.sh` drives the API with [autocannon](https://github.com/mcollina/autocannon) for the core
read and write paths. Run it against **staging** with production-like data, never production.

```bash
API=https://api.staging.walktogether.app TOKEN=<member access token> ACTIVITY_ID=<recording activity> ./loadtest/run.sh
```

## Baseline results (2026-11-10)

Environment: one API process (`node dist/main.js`, built bundle) + PostgreSQL 16/PostGIS + Redis on the
same 4-vCPU container; rate limiting disabled for the test; 50 concurrent connections, 15 s per scenario.
Synthetic dataset: 20 000 users, 2 000 clubs with PostGIS locations, 200 000 follows, 200 000 posts;
the test user follows 200 people.

| Scenario | Throughput (req/s, avg) | p50 | p97.5 | p99 | Errors |
| --- | --- | --- | --- | --- | --- |
| `GET /health/live` (baseline) | 4 950 | 9 ms | 18 ms | 21 ms | 0 |
| Club search (`GET /clubs?q=`) | 906 | 53 ms | 86 ms | 93 ms | 0 |
| Nearby clubs (PostGIS `ST_DWithin`) | 1 096 | 44 ms | 66 ms | 74 ms | 0 |
| Personalised feed (`GET /feed`) | 438 | 111 ms | 158 ms | 180 ms | 0 |
| Public profile | 698 | 70 ms | 93 ms | 102 ms | 0 |
| GPS batch ingestion (100 points/request) | 330 (≈33 000 points/s) | 147 ms | 198 ms | 215 ms | 0 |

Feed query plan (`EXPLAIN ANALYZE`, 200k posts): **5.0 ms**, driven by the `follows_pkey` and
`posts(created_at)` indexes — no sequential scans.

## Interpretation

* These are single-node numbers on shared hardware; they establish a regression baseline, **not** a
  capacity claim. Capacity planning must be repeated on staging with the production instance sizes,
  PgBouncer/RDS Proxy and several API replicas behind the load balancer.
* The API is stateless (sessions in Postgres/Redis, Socket.IO via the Redis adapter), so throughput
  scales horizontally until the database becomes the bottleneck; read replicas and feed caching are the
  next levers (see `docs/database/DATABASE_DESIGN.md`).
* Re-run after any change to the feed, discovery or ingestion paths and compare against this table.
