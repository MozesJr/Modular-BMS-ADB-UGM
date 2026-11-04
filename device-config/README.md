# device-config

Portal setelan untuk alat berbasis Raspberry Pi Zero W: setup WiFi lewat hotspot,
setelan MQTT, dan factory reset (dari web atau tombol fisik).

## Cara kerja

| Kondisi | Yang terjadi |
|---|---|
| Alat baru / habis reset | Langsung jadi hotspot `ALAT-XXXXXX`. OLED menampilkan nama hotspot, password, dan alamat `192.168.4.1`. |
| WiFi putus > 60 detik | Masuk mode setup (hotspot). Tiap 5 menit mencoba lagi WiFi lama, selama halaman web tidak sedang dipakai. |
| Ganti WiFi | WiFi baru dicoba dulu. Gagal -> kembali ke WiFi lama, atau ke hotspot kalau belum ada. |
| Ganti MQTT | Broker dites (TCP) sebelum disimpan. Gagal -> tidak disimpan, kecuali dicentang "Tetap simpan". |
| Tombol ditahan 3 detik | Paksa masuk mode setup. |
| Tombol ditahan 10 detik | Factory reset. |
| Factory reset | `config.json` kembali ke `defaults.json`, semua WiFi tersimpan dihapus, reboot -> mode setup. |

Setelah terhubung, halaman yang sama bisa dibuka dari jaringan yang sama lewat
IP di OLED atau `http://alat-xxxxxx.local/`.

## Wiring

- Tombol: GPIO17 (pin 11) ke GND (pin 9). Pull-up internal, tanpa resistor.
- OLED I2C: SDA GPIO2 (pin 3), SCL GPIO3 (pin 5), 3V3, GND. Cek alamat: `i2cdetect -y 1`.

## Pasang

1. Flash Raspberry Pi OS Lite 32-bit (Bookworm atau lebih baru).
2. Edit `settings.py`: ganti `SECRET_SALT`, sesuaikan `AP_PREFIX`, pin, driver OLED, `APP_SERVICE`.
3. Salin folder ini ke Pi, lalu `sudo ./install.sh`.

Log: `journalctl -u device-config -f`

## Integrasi dengan aplikasi utama

- Aplikasi utama membaca `/data/device-config/config.json` (struktur sama dengan `defaults.json`).
- Isi `APP_SERVICE` dengan nama service-nya supaya otomatis direstart tiap setelan berubah.
- Status jaringan ditulis ke `/run/device-config-status.json`.
- Kalau OLED sudah dipakai aplikasi utama, set `OLED_ENABLED = False` dan tampilkan
  status dari file di atas. Dua proses tidak bisa menggambar ke OLED yang sama.
- Setelan baru: tambah di `defaults.json`, tambah field di `templates/index.html`, simpan di route terkait di `main.py`.

## Coba di laptop (tanpa Pi)

    DEVCFG_MOCK=1 python3 main.py     # http://localhost:8080, password tercetak di log
