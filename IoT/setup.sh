#!/bin/bash

# Pastikan skrip dijalankan dengan sudo
if [ "$EUID" -ne 0 ]; then
  echo "Error: Harap jalankan skrip ini menggunakan sudo!"
  echo "Contoh: sudo bash setup.sh"
  exit 1
fi

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# 1. Salin file service ke folder sistem
cp "$SCRIPT_DIR/gama_bms.service" /etc/systemd/system/gama_bms.service

# 2. Reload daemon, aktifkan autostart, dan jalankan service
systemctl daemon-reload
systemctl enable gama_bms.service
systemctl restart gama_bms.service

echo "=========================================="
echo " Setup Selesai! Service Berhasil Aktif."
echo "=========================================="
systemctl status gama_bms.service --no-pager