#!/usr/bin/env bash
# Menjalankan PERINTAH APA PUN dengan TEST_DATABASE_URL yang menunjuk ke Postgres SEKALI-PAKAI di Docker.
#  - container hanya listen di 127.0.0.1, password acak, dihapus otomatis di akhir
#  - migrasi dijalankan dari SALINAN folder prisma/ di direktori temp, sehingga BE/.env tidak pernah terbaca
#    dan tidak mungkin menyentuh DB development/produksi
# Pakai:  bash scripts/with-test-db.sh <perintah> [argumen...]      (butuh Docker; port host: TEST_DB_PORT, default 54329)
set -euo pipefail

BE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NAME="bms-test-pg-$$"
PORT="${TEST_DB_PORT:-54329}"
PW="$(openssl rand -hex 12)"
TMP="$(mktemp -d)"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

docker run -d --rm --name "$NAME" \
  -e POSTGRES_USER=bmstest -e POSTGRES_PASSWORD="$PW" -e POSTGRES_DB=bms_test \
  -p "127.0.0.1:${PORT}:5432" postgres:16-alpine >/dev/null

# Image postgres start dua kali (server init sementara lalu server sebenarnya): tunggu "ready" muncul 2x.
for _ in $(seq 1 60); do
  [ "$(docker logs "$NAME" 2>&1 | grep -c 'ready to accept connections')" -ge 2 ] && break
  sleep 1
done

export TEST_DATABASE_URL="postgresql://bmstest:${PW}@127.0.0.1:${PORT}/bms_test"
export TEST_DB_CONTAINER="$NAME"
cp -R "$BE_DIR/prisma" "$TMP/prisma"
(cd "$TMP" && DATABASE_URL="$TEST_DATABASE_URL" "$BE_DIR/node_modules/.bin/prisma" migrate deploy --schema prisma/schema.prisma >/dev/null)

cd "$BE_DIR"
"$@"
