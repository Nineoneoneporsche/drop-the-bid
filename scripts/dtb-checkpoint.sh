#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

OUT="$ROOT/DTB_SESSION_SNAPSHOT.md"
NOW="$(date '+%Y-%m-%d %H:%M:%S %z')"

{
  echo "# DTB Session Snapshot"
  echo
  echo "Generated: $NOW"
  echo
  echo "## Git"
  echo
  echo '```text'
  echo "branch: $(git branch --show-current 2>/dev/null || echo unknown)"
  echo "head: $(git rev-parse HEAD 2>/dev/null || echo unknown)"
  echo
  echo "[status]"
  git status --short 2>/dev/null || true
  echo
  echo "[recent commits]"
  git log -10 --oneline --decorate 2>/dev/null || true
  echo '```'
  echo
  echo "## Changed files vs HEAD"
  echo
  echo '```text'
  git diff --name-status HEAD 2>/dev/null || true
  echo '```'
  echo
  echo "## Environment variable names only"
  echo
  echo "> Values are intentionally excluded."
  echo
  echo '```text'
  for f in .env .env.local .env.production .env.development; do
    if [ -f "$f" ]; then
      echo "[$f]"
      sed -nE 's/^([A-Za-z_][A-Za-z0-9_]*)=.*/\1/p' "$f" | sort -u
      echo
    fi
  done
  echo '```'
  echo
  echo "## Supabase migration files"
  echo
  echo '```text'
  if [ -d supabase/migrations ]; then
    find supabase/migrations -maxdepth 1 -type f -print | sort | tail -40
  else
    echo "supabase/migrations not found"
  fi
  echo '```'
  echo
  echo "## TODO"
  echo
  echo "- Update DTB_CURRENT_STATE.md before ending the session."
  echo "- Record durable decisions in DTB_DECISION_LOG.md."
  echo "- Never paste secrets into this snapshot."
} > "$OUT"

echo "Wrote: $OUT"
