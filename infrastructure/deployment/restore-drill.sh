#!/usr/bin/env bash
# Restore drill: restores a dump into a scratch database and verifies key tables.
# Usage: SOURCE_URL=postgres://.../walktogether ADMIN_URL=postgres://.../postgres ./restore-drill.sh
set -euo pipefail
dump=$(mktemp -t wtdrill.XXXX.dump)
pg_dump --format=custom --no-owner --no-privileges "$SOURCE_URL" -f "$dump"
drill="wt_restore_drill_$(date +%s)"
psql "$ADMIN_URL" -qc "CREATE DATABASE $drill"
target="${ADMIN_URL%/*}/$drill"
start=$(date +%s)
pg_restore --no-owner --no-privileges -d "$target" "$dump"
for t in users clubs club_memberships activities activity_gps_points payments invoices audit_logs; do
  a=$(psql "$SOURCE_URL" -tAc "SELECT count(*) FROM $t"); b=$(psql "$target" -tAc "SELECT count(*) FROM $t")
  [[ "$a" == "$b" ]] || { echo "MISMATCH in $t: $a vs $b"; exit 1; }
  echo "ok $t ($b rows)"
done
echo "restore drill passed in $(( $(date +%s) - start ))s"
psql "$ADMIN_URL" -qc "DROP DATABASE $drill"; rm -f "$dump"
