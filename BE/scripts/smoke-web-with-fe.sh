#!/usr/bin/env bash
# smoke:web + FE dev server sungguhan: memastikan cookie sesi yang diterbitkan BE juga diterima proxy FE
# (getToken di FE/src/proxy.ts) dan bahwa rewrite /api/backend/* meneruskan cookie. NEXTAUTH_SECRET sama di keduanya.
# Pakai: npm run smoke:web:fe
set -euo pipefail
BE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FE_DIR="$BE_DIR/../FE"
FE_PORT="${SMOKE_FE_PORT:-3101}"
BE_PORT="${SMOKE_PORT:-4100}"

cleanup() {
  [ -n "${FE_PID:-}" ] && kill "$FE_PID" 2>/dev/null || true
  pkill -f "next dev -p $FE_PORT" 2>/dev/null || true
  # next dev menulis AGENTS.md/CLAUDE.md bila belum ada; bersihkan bila tidak ter-track
  for f in AGENTS.md CLAUDE.md; do git -C "$FE_DIR" ls-files --error-unmatch "$f" >/dev/null 2>&1 || rm -f "$FE_DIR/$f"; done
}
trap cleanup EXIT

(cd "$FE_DIR" && BACKEND_URL="http://127.0.0.1:$BE_PORT" NEXTAUTH_SECRET=smoke-secret-not-real \
  npx next dev -p "$FE_PORT" >/dev/null 2>&1) &
FE_PID=$!

for _ in $(seq 1 60); do
  curl -s -o /dev/null "http://127.0.0.1:$FE_PORT/signin" && break
  sleep 1
done

SMOKE_FE_URL="http://127.0.0.1:$FE_PORT" bash "$BE_DIR/scripts/with-test-db.sh" npx tsx scripts/smoke-web-auth.ts
