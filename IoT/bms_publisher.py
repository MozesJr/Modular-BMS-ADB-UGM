import json, os, sys, time, signal, logging
import paho.mqtt.client as mqtt
from jk_bms import JKBMS

# ---------- Konfigurasi Environment ----------
BROKER    = os.environ.get("MQTT_BROKER_HOST", "72.61.208.150")
PORT      = int(os.environ.get("MQTT_BROKER_PORT", "1883"))
USERNAME  = os.environ.get("MQTT_USERNAME", "esp32_device")
PASSWORD  = os.environ.get("MQTT_PASSWORD", "eo6eCnnnY1K2YrJ1PgDwLH6")
DEVICE_ID = os.environ.get("DEVICE_ID", "GAMA-BMS-PACK-001")
INTERVAL  = float(os.environ.get("PUBLISH_INTERVAL", "10"))

SERIAL_PORT = os.getenv("BMS_PORT", "/dev/serial0")
BAUDRATE = int(os.getenv("BMS_BAUDRATE", "115200"))
REQUEST_INTERVAL = float(os.getenv("REQUEST_INTERVAL", "5"))

if not PASSWORD:
    sys.exit("[ERROR] MQTT_PASSWORD wajib diisi lewat environment")

TOPIC = f"bms/{DEVICE_ID}/data"

# Konfigurasi Logging
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("JK-BMS-MQTT")

running = True

def stop_handler(signum, frame):
    global running
    log.info("Sinyal penghentian diterima. Menghentikan program...")
    running = False

def setup_mqtt_client():
    try:
        client = mqtt.Client(
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"bms-{DEVICE_ID}",
        )
    except AttributeError:
        client = mqtt.Client(client_id=f"bms-{DEVICE_ID}")

    if USERNAME:
        client.username_pw_set(USERNAME, PASSWORD or None)

    def on_connect(client, userdata, flags, rc, *args):
        if rc == 0:
            log.info("MQTT Terhubung ke %s:%d", BROKER, PORT)
        else:
            log.error("MQTT Gagal terhubung, rc=%s", rc)

    client.on_connect = on_connect
    client.reconnect_delay_set(min_delay=1, max_delay=60)
    return client

def format_bms_payload(bms_data: dict, pack_index: int = 1) -> dict:
    """Mengubah format data dari JKBMS ke struktur JSON yang diharapkan."""
    cell_voltages_dict = bms_data.get("cell_voltages", {})
    cells = [
        {"index": int(cell_num), "voltage": round(v, 3)}
        for cell_num, v in sorted(cell_voltages_dict.items(), key=lambda x: int(x[0]))
    ]

    total_voltage = bms_data.get("voltage") or (sum(c["voltage"] for c in cells) if cells else 0.0)
    current = round(bms_data.get("current") or 0.0, 2)
    power = round(total_voltage * current, 2)

    # Memprioritaskan battery_temp, jika None gunakan temp lain
    temp = bms_data.get("battery_temp")
    if temp is None:
        temp = bms_data.get("power_temp", bms_data.get("box_temp", 0.0))

    pack_info = {
        "index": pack_index,
        "temperature": round(temp, 1) if temp is not None else 0.0,
        "balancerConnected": bms_data.get("charge_mos_enabled", True),
        "current": current,
        "power": power,
        "soc": bms_data.get("soc"),
        "voltage": round(total_voltage, 2),
        "cells": cells,
    }

    return {
        "timestamp": int(time.time() * 1000),
        "packs": [pack_info],
    }


def main():
    signal.signal(signal.SIGINT, stop_handler)
    signal.signal(signal.SIGTERM, stop_handler)

    bms = JKBMS(
        port=SERIAL_PORT,
        baudrate=BAUDRATE,
        request_interval=REQUEST_INTERVAL,
        debug=os.getenv("BMS_DEBUG", "0") == "1",
    )

    client = setup_mqtt_client()

    try:
        bms.connect()
        client.connect(BROKER, PORT, keepalive=60)
        client.loop_start()

        log.info("Bridge aktif. Port BMS: %s | Topic MQTT: %s", SERIAL_PORT, TOPIC)
        last_publish = 0.0

        while running:
            try:
                new_data = bms.read()
                now = time.monotonic()

                if new_data and new_data.get("valid") and (now - last_publish >= INTERVAL):
                    payload_dict = format_bms_payload(new_data)
                    msg = json.dumps(payload_dict)

                    info = client.publish(TOPIC, msg, qos=1)

                    pack0 = payload_dict["packs"][0]
                    voltages = [c["voltage"] for c in pack0["cells"]]
                    delta_mv = (max(voltages) - min(voltages)) * 1000 if voltages else 0

                    log.info(
                        "Published [%dB] rc=%s | P1 I=%+.2fA V=%.2fV SOC=%s%% Δ=%.0fmV",
                        len(msg),
                        info.rc,
                        pack0["current"],
                        pack0["voltage"],
                        pack0.get("soc"),
                        delta_mv,
                    )
                    last_publish = now

            except serial.SerialException as exc:
                log.error("Kesalahan Serial Port: %s", exc)
                time.sleep(2)
            except Exception as exc:
                log.exception("Kesalahan tak terduga pada loop utama: %s", exc)

            time.sleep(0.1)

    finally:
        log.info("Menutup koneksi...")
        client.loop_stop()
        client.disconnect()
        bms.close()
        log.info("Aplikasi dihentikan dengan bersih.")


if __name__ == "__main__":
    import serial
    main()