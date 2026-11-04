"""Konstanta device. Ubah di sini, bukan lewat halaman web."""
import hashlib
import os

# DEVCFG_MOCK=1 -> jalan di laptop tanpa nmcli/GPIO/OLED (untuk ngoprek tampilan web).
MOCK = os.environ.get("DEVCFG_MOCK") == "1"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get(
    "DEVCFG_DATA", os.path.join(BASE_DIR, "data") if MOCK else "/data/device-config"
)
CONFIG_PATH = os.path.join(DATA_DIR, "config.json")
DEFAULTS_PATH = os.path.join(BASE_DIR, "defaults.json")
# Status jaringan untuk dibaca aplikasi utama (mis. kalau OLED dipegang aplikasi itu).
STATUS_PATH = os.path.join(DATA_DIR, "status.json") if MOCK else "/run/device-config-status.json"

# WAJIB diganti sebelum produksi. Pakai string yang sama di semua alat supaya
# password tiap alat bisa dihitung ulang dari serial-nya.
SECRET_SALT = "GANTI-DENGAN-STRING-RAHASIA"

# --- Jaringan ---
WIFI_IFACE = "wlan0"
AP_CON = "device-ap"          # profil NetworkManager untuk hotspot
WIFI_CON = "device-wifi"      # profil untuk WiFi pelanggan
AP_PREFIX = "ALAT"
AP_IP = "192.168.4.1"
WEB_PORT = 8080 if MOCK else 80

WIFI_GRACE_S = 60     # offline selama ini -> masuk mode setup (hotspot)
AP_RETRY_S = 300      # di mode setup, coba lagi WiFi tersimpan tiap sekian detik
AP_IDLE_S = 180       # ...tapi hanya kalau halaman web tidak dipakai selama ini

# --- Hardware ---
BUTTON_GPIO = 17      # tombol antara GPIO17 (pin 11) dan GND (pin 9)
HOLD_SETUP_S = 3      # tahan >= 3 dtk  -> mode setup
HOLD_RESET_S = 10     # tahan >= 10 dtk -> factory reset

# Set False kalau OLED sudah dipakai aplikasi utama (dua proses tidak bisa
# menggambar ke OLED yang sama). Aplikasi utama bisa baca STATUS_PATH.
OLED_ENABLED = True
OLED_DRIVER = "ssd1306"   # atau "sh1106"
OLED_I2C_PORT = 1
OLED_I2C_ADDR = 0x3C

# Service aplikasi utama (pembaca sensor / publisher MQTT) yang direstart
# setiap config berubah. Kosongkan kalau tidak ada.
APP_SERVICE = ""


def _serial():
    try:
        with open("/proc/cpuinfo") as f:
            for line in f:
                if line.startswith("Serial"):
                    return line.split(":")[1].strip()
    except OSError:
        pass
    return "0000000000000000"


SERIAL = _serial()
DEVICE_ID = SERIAL[-6:].upper()
AP_SSID = f"{AP_PREFIX}-{DEVICE_ID}"
# Password hotspot sekaligus password login awal. Unik per alat.
DEVICE_KEY = hashlib.sha256((SECRET_SALT + SERIAL).encode()).hexdigest()[:8]
