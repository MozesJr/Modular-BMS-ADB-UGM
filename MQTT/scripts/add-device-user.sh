#!/usr/bin/env bash
# Menambah/mengganti user MQTT untuk SATU device (tahap "user per device", BELUM diaktifkan secara default).
#
#   MQTT/scripts/add-device-user.sh <device_id>              # password dari env MQTT_PASSWORD_<ID> atau prompt
#   MQTT/scripts/add-device-user.sh <device_id> --generate   # buat password acak, simpan ke MQTT/provisioning/<id>.credentials (0600)
#
# device_id = Device.serialNumber = username MQTT. Agar user ini berguna, ACL harus memakai pola %u
# (lihat config/acl_file.per-device.example). Password acak TIDAK dicetak ke layar; file kredensialnya
# untuk dimasukkan ke firmware (NVS) lalu dihapus.
# Setelah menambah user, muat ulang broker:  docker compose kill -s SIGHUP mosquitto
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
require_docker

id="${1:-}"
[[ "$id" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || { echo "Pemakaian: $0 <device_id> [--generate]  (device_id: [A-Za-z0-9._-], maks 64)" >&2; exit 1; }
[ -f "$PASSWD_FILE" ] || { echo "$PASSWD_FILE belum ada. Jalankan scripts/init-passwd.sh dulu." >&2; exit 1; }

if [ "${2:-}" = "--generate" ]; then
  PW="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"
  mkdir -p "$MQTT_DIR/provisioning"
  ( umask 077; printf 'username=%s\npassword=%s\n' "$id" "$PW" > "$MQTT_DIR/provisioning/$id.credentials" )
  echo "Kredensial disimpan di MQTT/provisioning/$id.credentials (mode 0600, di-gitignore)."
else
  read_password "$id"
fi

hash_into_file append "$id"
fix_permissions >/dev/null
echo "User '$id' ditambahkan/diperbarui. Muat ulang broker:  docker compose kill -s SIGHUP mosquitto"
