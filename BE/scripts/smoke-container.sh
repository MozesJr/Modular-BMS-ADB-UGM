#!/usr/bin/env bash
# Membangun image BE (target runner), menjalankannya terhadap Postgres sekali-pakai, lalu menjalankan smoke:web
# terhadap container itu. Menguji Dockerfile (versi Node, user non-root, HEALTHCHECK) + alur login.
# Pakai: npm run smoke:container
set -euo pipefail
BE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
[ -n "${TEST_DATABASE_URL:-}" ] || exec bash "$BE_DIR/scripts/with-test-db.sh" bash "$0"

IMG="bms-backend:smoke"
NAME="bms-be-smoke-$$"
PORT="${SMOKE_CONTAINER_PORT:-4055}"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

docker build -q -t "$IMG" "$BE_DIR" >/dev/null
echo "node di image : $(docker run --rm --entrypoint node "$IMG" -v)"
echo "user di image : $(docker run --rm --entrypoint sh "$IMG" -c 'id -un')"

CONTAINER_DB_URL="${TEST_DATABASE_URL/127.0.0.1/host.docker.internal}"
docker run -d --name "$NAME" --init -p "127.0.0.1:${PORT}:4000" \
  -e DATABASE_URL="$CONTAINER_DB_URL" -e NEXTAUTH_SECRET=smoke-secret-not-real \
  -e JWT_ACCESS_SECRET=smoke-access-secret-not-real-0123456789 \
  -e MQTT_BROKER_URL=mqtt://127.0.0.1:1 -e APP_URL=http://localhost:3999 "$IMG" >/dev/null

cd "$BE_DIR"
SMOKE_BASE_URL="http://127.0.0.1:${PORT}" npx tsx scripts/smoke-web-auth.ts
docker stop "$NAME" >/dev/null
echo "exit code container setelah SIGTERM: $(docker inspect -f '{{.State.ExitCode}}' "$NAME")"
