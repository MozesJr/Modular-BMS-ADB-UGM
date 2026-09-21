#!/usr/bin/env bash
# Fungsi bersama untuk init-passwd.sh dan add-device-user.sh. Di-source, bukan dijalankan.
# Prinsip: password TIDAK pernah ditulis ke repo, TIDAK masuk argv proses host (tidak terlihat di `ps`),
# dan TIDAK dicetak. Hash dibuat oleh mosquitto_passwd di dalam container sementara.

MQTT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${MOSQUITTO_IMAGE:-eclipse-mosquitto:2.0.22}"
PASSWD_FILE="${PASSWD_FILE:-$MQTT_DIR/secrets/password_file}"
MIN_PASSWORD_LEN=12

require_docker() { command -v docker >/dev/null || { echo "Docker tidak ditemukan" >&2; exit 1; }; mkdir -p "$(dirname "$PASSWD_FILE")"; }

# Nama variabel env untuk user tertentu: esp32_device -> MQTT_PASSWORD_ESP32_DEVICE
env_name_for() { printf 'MQTT_PASSWORD_%s' "$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]' | tr -c 'A-Z0-9\n' '_')"; }

# read_password <user> -> mengisi variabel global PW dari env atau prompt (dua kali).
read_password() {
  local user="$1" var val second
  var="$(env_name_for "$user")"
  val="${!var:-}"
  if [ -z "$val" ]; then
    [ -t 0 ] || { echo "Tidak ada TTY dan \$$var kosong untuk user '$user'" >&2; exit 1; }
    read -r -s -p "Password untuk '$user': " val; echo >&2
    read -r -s -p "Ulangi password         : " second; echo >&2
    [ "$val" = "$second" ] || { echo "Password tidak sama" >&2; exit 1; }
  fi
  [ "${#val}" -ge "$MIN_PASSWORD_LEN" ] || { echo "Password '$user' minimal $MIN_PASSWORD_LEN karakter" >&2; exit 1; }
  PW="$val"
}

# hash_into_file <create|append> <user>  — memakai $PW (variabel env diteruskan ke container tanpa nilai di argv)
hash_into_file() {
  local mode="$1" user="$2" flag=""
  [ "$mode" = create ] && flag="-c"
  export PW
  docker run --rm --user "$(id -u):$(id -g)" -e PW \
    -v "$(dirname "$PASSWD_FILE"):/work" "$IMAGE" \
    sh -c "mosquitto_passwd -b $flag /work/$(basename "$PASSWD_FILE") \"\$0\" \"\$PW\"" "$user" >/dev/null 2>&1 \
    || { echo "mosquitto_passwd gagal untuk '$user'" >&2; exit 1; }
  unset PW
}

# Izin file: bila dijalankan sebagai root -> milik uid mosquitto (1883) mode 0600 (ideal).
# Bila bukan root -> 0644 supaya container (uid 1883) bisa membaca; isinya hash PBKDF2-SHA512, bukan plaintext.
fix_permissions() {
  if [ "$(id -u)" = 0 ]; then
    chown 1883:1883 "$PASSWD_FILE" && chmod 0600 "$PASSWD_FILE"
    echo "Izin: milik 1883:1883, mode 0600."
  else
    chmod 0644 "$PASSWD_FILE"
    echo "Izin: mode 0644 (bukan root). Untuk 0600 yang ketat: sudo chown 1883:1883 $PASSWD_FILE && sudo chmod 0600 $PASSWD_FILE"
  fi
}
