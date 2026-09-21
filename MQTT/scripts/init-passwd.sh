#!/usr/bin/env bash
# Membuat MQTT/secrets/password_file (hash PBKDF2-SHA512) tanpa menuliskan password ke repo.
#
#   MQTT/scripts/init-passwd.sh                      # user default: esp32_device backend_service
#   MQTT/scripts/init-passwd.sh user1 user2 ...      # user lain
#
# Password diambil dari env MQTT_PASSWORD_<USER> (mis. MQTT_PASSWORD_ESP32_DEVICE) bila ada, jika tidak
# diminta lewat prompt (tersembunyi, dua kali). Minimal 12 karakter. Menolak menimpa file yang sudah ada
# kecuali FORCE=1. File hasil di-gitignore.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
require_docker

users=("$@")
[ ${#users[@]} -gt 0 ] || users=(esp32_device backend_service)

if [ -e "$PASSWD_FILE" ] && [ "${FORCE:-0}" != 1 ]; then
  echo "$PASSWD_FILE sudah ada. Jalankan FORCE=1 $0 untuk membuat ulang (semua user harus diisi ulang)." >&2
  exit 1
fi
[ -d "$PASSWD_FILE" ] && { echo "$PASSWD_FILE adalah DIREKTORI (dibuat Docker karena file belum ada). Hapus dulu: rmdir '$PASSWD_FILE'" >&2; exit 1; }
rm -f "$PASSWD_FILE"

mode=create
for u in "${users[@]}"; do
  [[ "$u" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || { echo "Nama user tidak valid: $u" >&2; exit 1; }
  read_password "$u"
  hash_into_file "$mode" "$u"
  mode=append
  echo "user '$u' ditambahkan."
done
fix_permissions
echo "Selesai: $PASSWD_FILE (${#users[@]} user). Jangan di-commit (sudah di-gitignore)."
