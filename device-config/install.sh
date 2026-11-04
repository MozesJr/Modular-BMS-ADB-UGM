#!/bin/bash
# Pasang di Raspberry Pi OS Lite (Bookworm atau lebih baru, yang pakai NetworkManager).
#   sudo ./install.sh
set -euo pipefail

[ "$EUID" -eq 0 ] || { echo "Jalankan dengan sudo."; exit 1; }
command -v nmcli >/dev/null || { echo "nmcli tidak ada. Butuh Raspberry Pi OS Bookworm+."; exit 1; }

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST=/opt/device-config

if grep -q 'SECRET_SALT = "GANTI' "$SRC/settings.py"; then
  echo "PERINGATAN: SECRET_SALT di settings.py masih bawaan. Ganti sebelum produksi."
fi

echo "== Paket =="
apt-get update
# dnsmasq-base saja (dipakai NetworkManager untuk DHCP hotspot). JANGAN pasang
# paket 'dnsmasq' penuh: service-nya akan bentrok di port 53.
apt-get install -y dnsmasq-base avahi-daemon i2c-tools \
  python3-flask python3-gpiozero python3-lgpio python3-pil
apt-get install -y python3-luma.oled || {
  apt-get install -y python3-pip
  pip3 install --break-system-packages luma.oled
}
raspi-config nonint do_i2c 0 || true

echo "== File =="
mkdir -p "$DEST" /data/device-config
cp -r "$SRC"/*.py "$SRC"/defaults.json "$SRC"/templates "$DEST"/
chmod 700 /data/device-config

echo "== Captive portal =="
# Di mode hotspot, semua nama domain dijawab dengan IP alat -> HP memunculkan
# pop-up "Sign in to network" dan langsung membuka halaman setelan.
AP_IP=$(cd "$DEST" && python3 -c "import settings; print(settings.AP_IP)")
mkdir -p /etc/NetworkManager/dnsmasq-shared.d
echo "address=/#/$AP_IP" > /etc/NetworkManager/dnsmasq-shared.d/captive.conf

echo "== Hostname (untuk akses http://<hostname>.local) =="
ID=$(cd "$DEST" && python3 -c "import settings; print(settings.DEVICE_ID.lower())")
NAME="alat-$ID"
hostnamectl set-hostname "$NAME"
if grep -q '^127.0.1.1' /etc/hosts; then
  sed -i "s/^127.0.1.1.*/127.0.1.1\t$NAME/" /etc/hosts
else
  echo -e "127.0.1.1\t$NAME" >> /etc/hosts
fi

echo "== Service =="
cp "$SRC/device-config.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable device-config.service
systemctl restart device-config.service

echo
cd "$DEST" && python3 -c "
import settings as s
print('Terpasang.')
print('  Hotspot setup :', s.AP_SSID)
print('  Password      :', s.DEVICE_KEY, '(hotspot + login awal)')
print('  Halaman       : http://%s/ (mode setup) atau http://$NAME.local/' % s.AP_IP)
"
