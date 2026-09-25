import json, os, sys, time, random
import paho.mqtt.client as mqtt

# Semua kredensial WAJIB dari environment — tidak ada default rahasia di file ini.
BROKER    = os.environ.get("MQTT_BROKER_HOST", "72.61.208.150")
PORT      = int(os.environ.get("MQTT_BROKER_PORT", "1883"))
USERNAME  = os.environ.get("MQTT_USERNAME", "esp32_device")   # ACL: hanya akun ini boleh publish bms/+/data
PASSWORD  = os.environ.get("MQTT_PASSWORD", "eo6eCnnnY1K2YrJ1PgDwLH6")
DEVICE_ID = os.environ.get("DEVICE_ID", "GAMA-BMS-PACK-001")
INTERVAL  = int(os.environ.get("PUBLISH_INTERVAL", "10"))     # samakan dgn ESP32; >20s = gap di chart

if not PASSWORD:
    sys.exit("MQTT_PASSWORD wajib diisi lewat environment")

TOPIC = f"bms/{DEVICE_ID}/data"
CELL_COUNT = 24
V_MIN, V_MAX = 3.20, 3.45        # LiFePO4 area plateau
CELL_OFFSET_MV = 8               # sebaran normal antar cell (±mV) -> delta ~15–25 mV
CURRENT_MAX = 5.0                # ACS712-05B

# offset tetap per cell (karakter sel), + random walk untuk tegangan dasar & arus
offsets = [random.uniform(-CELL_OFFSET_MV, CELL_OFFSET_MV) / 1000 for _ in range(CELL_COUNT)]
base_v = 3.30
current = -2.0                   # negatif = charging
temp = 26.0


def step():
    global base_v, current, temp
    # arus berubah pelan, sesekali berbalik arah (charge <-> discharge)
    current += random.uniform(-0.3, 0.3)
    if random.random() < 0.02:
        current = -current
    current = max(-CURRENT_MAX, min(CURRENT_MAX, current))
    # tegangan naik saat charging (arus negatif), turun saat discharge
    base_v += -current * 0.0004 + random.uniform(-0.0005, 0.0005)
    base_v = max(V_MIN, min(V_MAX, base_v))
    temp += abs(current) * 0.01 - (temp - 26.0) * 0.05 + random.uniform(-0.1, 0.1)

    cells = [
        {"index": i + 1, "voltage": round(base_v + offsets[i] + random.uniform(-0.002, 0.002), 3)}
        for i in range(CELL_COUNT)
    ]
    pack_v = sum(c["voltage"] for c in cells)
    return {
        "timestamp": int(time.time() * 1000),
        "packs": [{
            "index": 1,
            "temperature": round(temp, 1),
            "balancerConnected": True,
            "current": round(current, 2),
            "power": round(pack_v * current, 2),
            "cells": cells,
        }],
    }


def on_connect(client, userdata, flags, rc, *args):
    print("[MQTT] Connected" if rc == 0 else f"[MQTT] Connect failed rc={rc}")


# paho-mqtt 2.x butuh callback_api_version; 1.x tidak punya atribut ini
try:
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1, client_id=f"bms-sim-{DEVICE_ID}")
except AttributeError:
    client = mqtt.Client(client_id=f"bms-sim-{DEVICE_ID}")

client.username_pw_set(USERNAME, PASSWORD)
client.on_connect = on_connect
client.reconnect_delay_set(min_delay=1, max_delay=30)

print(f"[MQTT] Connecting to {BROKER}:{PORT} as {USERNAME} -> {TOPIC}")
client.connect(BROKER, PORT, keepalive=60)
client.loop_start()

try:
    while True:
        payload = step()
        p = payload["packs"][0]
        vs = [c["voltage"] for c in p["cells"]]
        info = client.publish(TOPIC, json.dumps(payload), qos=1)
        print(f"[{time.strftime('%H:%M:%S')}] rc={info.rc} I={p['current']:+.2f}A "
              f"Vavg={sum(vs)/len(vs):.3f} Δ={(max(vs)-min(vs))*1000:.0f}mV T={p['temperature']}°C")
        time.sleep(INTERVAL)
except KeyboardInterrupt:
    print("\n[SYSTEM] Stopping...")
finally:
    client.loop_stop()
    client.disconnect()