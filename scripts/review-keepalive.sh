#!/usr/bin/env bash
# PG review mode keep-alive (TEMPORARY, 2026-11): renews the health lease
# every 5 s so a live round with nobody watching is not auto-paused
# (touch_health_lease(), 10 s lease — see
# supabase/migrations/20260917100000_fail_closed_pause.sql). It calls only
# the public /api/game/heartbeat probe, the same one every open drop page
# polls. Stop it (Ctrl+C / kill) when the review drop is turned off.
#
#   ./scripts/review-keepalive.sh                # https://dropthebid.com
#   ./scripts/review-keepalive.sh http://localhost:3000
set -uo pipefail

BASE="${1:-https://dropthebid.com}"
URL="$BASE/api/game/heartbeat"
fails=0
echo "keep-alive -> $URL (every 5s)"
while true; do
  code=$(curl -s -o /dev/null -m 4 -w '%{http_code}' "$URL")
  if [ "$code" = "200" ]; then
    if [ "$fails" -gt 0 ]; then echo "$(date '+%F %T') recovered after $fails failure(s)"; fi
    fails=0
  else
    fails=$((fails + 1))
    echo "$(date '+%F %T') heartbeat HTTP $code (fail #$fails)"
  fi
  sleep 5
done
