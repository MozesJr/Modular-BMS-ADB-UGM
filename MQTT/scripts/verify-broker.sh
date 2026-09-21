#!/usr/bin/env bash
# Memverifikasi konfigurasi broker (auth, ACL, batas ukuran, healthcheck) pada broker SEKALI-PAKAI:
#   - image dibangun dari MQTT/Dockerfile, dijalankan di network Docker sementara TANPA port ke host
#   - password acak, file password sementara; tidak menyentuh broker produksi maupun config/password_file asli
# Pakai:  MQTT/scripts/verify-broker.sh      (butuh Docker)
set -uo pipefail
MQTT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ID="$$"
NET="bms-verify-net-$ID"; BROKER="bms-verify-broker-$ID"; IMG="bms-mqtt:verify"
TMP="$(mktemp -d)"
DEV_PW="$(openssl rand -hex 12)"; BE_PW="$(openssl rand -hex 12)"
cleanup() { docker rm -f "$BROKER" "bms-verify-sub-$ID" "bms-verify-sub2-$ID" "bms-verify-sub3-$ID" >/dev/null 2>&1; docker network rm "$NET" >/dev/null 2>&1; rm -rf "$TMP"; }
trap cleanup EXIT

pass=0; fail=0
check() { if [ "$2" = ok ]; then pass=$((pass+1)); echo "PASS  $1"; else fail=$((fail+1)); echo "FAIL  $1  <- $3"; fi; }

docker build -q -t "$IMG" "$MQTT_DIR" >/dev/null || { echo "build gagal"; exit 1; }
echo "versi broker : $(docker run --rm "$IMG" mosquitto -h 2>&1 | head -1)"

mkdir -p "$TMP/secrets"
PASSWD_FILE="$TMP/secrets/password_file" MQTT_PASSWORD_ESP32_DEVICE="$DEV_PW" MQTT_PASSWORD_BACKEND_SERVICE="$BE_PW" \
  bash "$MQTT_DIR/scripts/init-passwd.sh" >/dev/null || { echo "init-passwd gagal"; exit 1; }
check "init-passwd.sh membuat password_file berisi hash (bukan plaintext)" \
  "$( [ "$(grep -c '\$7\$' "$TMP/secrets/password_file")" = 2 ] && ! grep -q "$DEV_PW" "$TMP/secrets/password_file" && echo ok || echo no )" "isi file tak sesuai"

docker network create "$NET" >/dev/null
docker run -d --name "$BROKER" --network "$NET" -v "$TMP/secrets:/mosquitto/secrets:ro" "$IMG" >/dev/null
for _ in $(seq 1 30); do [ "$(docker inspect -f '{{.State.Health.Status}}' "$BROKER" 2>/dev/null)" = healthy ] && break; sleep 1; done
check "HEALTHCHECK compose/Dockerfile -> healthy" "$( [ "$(docker inspect -f '{{.State.Health.Status}}' "$BROKER")" = healthy ] && echo ok || echo no )" "$(docker inspect -f '{{.State.Health.Status}}' "$BROKER")"

STARTUP_LOG="$(docker logs "$BROKER" 2>&1)"   # sebelum ada klien: hanya baris startup

M() { docker run --rm -i --network "$NET" "$IMG" "$@" 2>&1; }           # jalankan klien mosquitto_*
cid() { echo "verify-$RANDOM$RANDOM"; }   # klien nyata (ESP32) selalu mengirim client-id; id kosong memang ditolak broker
dev_pub() { M mosquitto_pub -h "$BROKER" -i "$(cid)" -V mqttv5 -q 1 -u esp32_device -P "$DEV_PW" "$@"; }
be_pub()  { M mosquitto_pub -h "$BROKER" -i "$(cid)" -V mqttv5 -q 1 -u backend_service -P "$BE_PW" "$@"; }
# -d menampilkan kode alasan SUBACK ("Subscribed (mid: 1): 135" = not authorized)
sub_as()  { local u="$1" p="$2"; shift 2; M mosquitto_sub -d -h "$BROKER" -i "$(cid)" -V mqttv5 -u "$u" -P "$p" "$@"; }
logs()    { docker logs "$1" 2>&1; }   # ditangkap ke variabel dulu: grep -q + pipefail bisa memberi hasil salah (SIGPIPE)
# "ditolak" = broker menjawab penolakan eksplisit (bukan sekadar error koneksi lain)
denied()  { grep -qiE "not authori[sz]ed|Subscribed \(mid: [0-9]+\): (135|128)|Publish [0-9]+ failed|Connection Refused" <<<"$1"; }
# "diterima" = tidak ada keluaran apa pun dari mosquitto_pub
accepted() { [ -z "$1" ]; }

# 1) tanpa kredensial / password salah
out="$(M mosquitto_pub -h "$BROKER" -i "$(cid)" -V mqttv5 -t bms/X/data -m '{}' -q 1)"; denied "$out" && r=ok || r=no
check "koneksi anonim ditolak" "$r" "$out"
out="$(M mosquitto_pub -h "$BROKER" -i "$(cid)" -V mqttv5 -u esp32_device -P salah -t bms/X/data -m '{}' -q 1)"; denied "$out" && r=ok || r=no
check "password salah ditolak" "$r" "$out"

# 2) publish sah lolos dan sampai ke backend (subscriber backend_service)
docker run -d --name "bms-verify-sub-$ID" --network "$NET" "$IMG" mosquitto_sub -h "$BROKER" -i verify-sub-1 -V mqttv5 -u backend_service -P "$BE_PW" -t 'bms/+/data' -v -W 25 >/dev/null
sleep 2
out="$(dev_pub -t bms/DEV-1/data -m '{"ok":1}')"; accepted "$out" && r=ok || r=no
check "esp32_device publish bms/DEV-1/data diterima broker" "$r" "$out"
sleep 2
L="$(logs "bms-verify-sub-$ID")"; grep -qF 'bms/DEV-1/data {"ok":1}' <<<"$L" && r=ok || r=no
check "backend_service menerima pesan dari bms/+/data" "$r" "tidak diterima"

# 3) ACL: yang tidak diizinkan ditolak
out="$(dev_pub -t bms/DEV-1/status -m online)"; accepted "$out" && r=ok || r=no;                check "esp32_device publish bms/DEV-1/status diizinkan" "$r" "$out"
out="$(dev_pub -t other/topic -m x)";           denied "$out" && r=ok || r=no;                  check "esp32_device publish topik lain ditolak" "$r" "$out"
out="$(dev_pub -t bms/DEV-1/cmd -m x)";         denied "$out" && r=ok || r=no;                  check "esp32_device publish bms/DEV-1/cmd ditolak" "$r" "$out"
out="$(dev_pub -t bms/DEV-1/data/extra -m x)";  denied "$out" && r=ok || r=no;                  check "esp32_device publish bms/DEV-1/data/extra ditolak" "$r" "$out"
# Catatan Mosquitto: SUBACK untuk topik tanpa hak baca tetap "granted"; ACL read ditegakkan saat PENGIRIMAN pesan.
# Maka uji hak baca = pesan tidak sampai ke subscriber tsb (dengan kontrol positif: backend_service menerima pesan yang sama).
docker run -d --name "bms-verify-sub3-$ID" --network "$NET" "$IMG" mosquitto_sub -h "$BROKER" -i verify-sub-3 -V mqttv5 -u esp32_device -P "$DEV_PW" -t 'bms/DEV-9/data' -v -W 8 >/dev/null
sleep 2
dev_pub -t bms/DEV-9/data -m '{"n":9}' >/dev/null
sleep 3
L1="$(logs "bms-verify-sub-$ID")"; L3="$(logs "bms-verify-sub3-$ID")"
grep -qF 'bms/DEV-9/data {"n":9}' <<<"$L1" && r=ok || r=no
check "kontrol positif: backend_service menerima bms/DEV-9/data" "$r" "tidak diterima"
grep -qF 'bms/DEV-9/data' <<<"$L3" && r=no || r=ok
check "esp32_device TIDAK menerima pesan bms/ (tidak punya hak read), walau SUBACK granted" "$r" "pesan terkirim ke esp32_device"
out="$(be_pub -t bms/DEV-1/data -m x)";         denied "$out" && r=ok || r=no;                  check "backend_service TIDAK boleh publish" "$r" "$out"
out="$(M mosquitto_sub -h "$BROKER" -i "$(cid)" -V mqttv5 -u backend_service -P "$BE_PW" -t '$SYS/#' -C 1 -W 3 -v)"
[ "$(grep -c 'SYS' <<<"$out")" = 0 ] && r=ok || r=no
check "backend_service TIDAK menerima \$SYS/# (retained \$SYS/broker/version tidak dikirim)" "$r" "$out"

# 4) batas ukuran pesan (message_size_limit 65536)
docker run -d --name "bms-verify-sub2-$ID" --network "$NET" "$IMG" mosquitto_sub -h "$BROKER" -i verify-sub-2 -V mqttv5 -u backend_service -P "$BE_PW" -t 'bms/BIG/data' -v -W 20 >/dev/null
sleep 2
head -c 60000 /dev/zero | tr '\0' 'a' | M mosquitto_pub -h "$BROKER" -i "$(cid)" -V mqttv5 -q 1 -u esp32_device -P "$DEV_PW" -t bms/BIG/data -s >/dev/null
sleep 2
L="$(logs "bms-verify-sub2-$ID")"; [ "$(grep -c '^bms/BIG/data a' <<<"$L")" = 1 ] && r=ok || r=no
check "payload 60.000 byte (< 64 KiB) lolos" "$r" "tidak diterima"
out="$(head -c 70000 /dev/zero | tr '\0' 'a' | M mosquitto_pub -h "$BROKER" -i "$(cid)" -V mqttv5 -q 1 -u esp32_device -P "$DEV_PW" -t bms/BIG/data -s)"
sleep 2
L="$(logs "bms-verify-sub2-$ID")"; [ "$(grep -c '^bms/BIG/data a' <<<"$L")" = 1 ] && r=ok || r=no
check "payload 70.000 byte (> 64 KiB) TIDAK diteruskan ke subscriber" "$r" "ikut diteruskan"

# 4b) keepalive: max_keepalive 300
out="$(M mosquitto_pub -h "$BROKER" -i "$(cid)" -V mqttv311 -k 60 -q 1 -u esp32_device -P "$DEV_PW" -t bms/DEV-1/data -m '{}')"; accepted "$out" && r=ok || r=no
check "MQTT 3.1.1 keepalive 60 dtk diterima" "$r" "$out"
out="$(M mosquitto_pub -d -h "$BROKER" -i "$(cid)" -V mqttv311 -k 600 -q 1 -u esp32_device -P "$DEV_PW" -t bms/DEV-1/data -m '{}')"
echo "INFO  keepalive 600 (3.1.1) ->  $(grep -iE 'CONNACK|refused|error' <<<"$out" | head -2 | tr '\n' ' ')"

# 5) proses broker tidak berjalan sebagai root setelah start
user="$(docker exec "$BROKER" sh -c 'ps -o user,comm' | awk '/mosquitto/ {print $1; exit}')"
[[ "$user" == mosquit* ]] && r=ok || r=no; check "proses mosquitto berjalan sebagai user 'mosquitto' (bukan root)" "$r" "user=$user"

# 6) log startup: tanpa error konfigurasi; peringatan izin password_file hanya informasi
BL="$STARTUP_LOG"
if grep -qiE "error|unable to open|invalid|unknown configuration" <<<"$BL"; then r=no; else r=ok; fi
check "log startup tanpa error konfigurasi" "$r" "$(grep -iE 'error|unable|invalid|unknown' <<<"$BL" | head -3)"
grep -qi "acl_file has world readable" <<<"$BL" && r=no || r=ok
check "conf/ACL yang di-bake tidak memicu peringatan izin (pemilik mosquitto, 0600)" "$r" "ACL world readable"
grep -qi "password_file has world readable" <<<"$BL" && echo "INFO  peringatan 'world readable' pada password_file (host non-root, mode 0644): normal di dev; di VPS ikuti README (chown 1883:1883 + 0600)"

echo; echo "HASIL verifikasi broker: $pass pass, $fail fail"
[ "$fail" = 0 ]
