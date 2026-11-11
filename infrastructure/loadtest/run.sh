#!/usr/bin/env bash
# Load test for core read/write paths. Usage: API=http://localhost:4000 TOKEN=<member access token> ./infrastructure/loadtest/run.sh
# Run against an environment with production-like data (see infrastructure/loadtest/README.md). Never against production.
set -euo pipefail
API=${API:-http://localhost:4000}
C=${CONNECTIONS:-50}
D=${DURATION:-20}
run() { echo "== $1"; npx -y autocannon@8 -c "$C" -d "$D" "${@:2}" 2>&1 | grep -E "Latency|Req/Sec|requests in|2xx|non 2xx" ; }
run "health (baseline)"               "$API/health/live"
run "club discovery (search)"         "$API/api/v1/clubs?limit=20&q=Load"
run "nearby clubs (PostGIS)"          "$API/api/v1/clubs?near=-1.29,36.82&radiusKm=10&limit=20"
run "personalised feed"               -H "Authorization: Bearer $TOKEN" "$API/api/v1/feed?limit=20"
run "public profile"                  "$API/api/v1/users/lt_100"
if [[ -n "${ACTIVITY_ID:-}" ]]; then
  run "GPS batch ingestion (100 points/request, idempotent retries)" -m POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -i "${POINTS_FILE:-infrastructure/loadtest/points.json}" "$API/api/v1/activities/$ACTIVITY_ID/gps-points"
fi
