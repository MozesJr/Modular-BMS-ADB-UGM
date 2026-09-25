import json, os, sys, time, random
import paho.mqtt.client as mqtt

BROKER     = os.environ.get("MQTT_BROKER_HOST", "72.61.208.150")
PORT       = int(os.environ.get("MQTT_BROKER_PORT", "1883"))
USERNAME   = os.environ.get("MQTT_USERNAME", "esp32_device")
PASSWORD   = os.environ.get("MQTT_PASSWORD", "eo6eCnnnY1K2YrJ1PgDwLH6")
DEVICE_ID  = os.environ.get("DEVICE_ID", "GAMA-BMS-PACK-001")
INTERVAL   = int(os.environ.get("PUBLISH_INTERVAL", "10"))
PACK_COUNT = int(os.environ.get("PACK_COUNT", "1"))
CELL_COUNT = int(os.environ.get("CELL_COUNT", "24"))      # cell per pack

if not PASSWORD:
    sys.exit("MQTT_PASSWORD wajib diisi lewat environment")

TOPIC = f"bms/{DEVICE_ID}/data"
V_MIN, V_MAX = 3.20, 3.45
CELL_OFFSET_MV = 8
CURRENT_MAX = 5.0


class Pack:
    def __init__(self, index):
        self.index = index
        self.offsets = [random.uniform(-CELL_OFFSET_MV, CELL_OFFSET_MV) / 1000 for _ in range(CELL_COUNT)]
        self.base_v = random.uniform(3.28, 3.34)
        self.current = random.choice([-1, 1]) * random.uniform(1.0, 3.0)
        self.temp = random.uniform(25.5, 27.0)

    def step(self):
        self.current += random.uniform(-0.3, 0.3)
        if random.random() < 0.02:
            self.current = -self.current
        self.current = max(-CURRENT_MAX, min(CURRENT_MAX, self.current))
        self.base_v += -self.current * 0.0004 + random.uniform(-0.0005, 0.0005)
        self.base_v = max(V_MIN, min(V_MAX, self.base_v))
        self.temp += abs(self.current) * 0.01 - (self.temp - 26.0) * 0.05 + random.uniform(-0.1, 0.1)

        cells = [
            {"index": i + 1, "voltage": round(self.base_v + self.offsets[i] + random.uniform(-0.002, 0.002), 3)}
            for i in range(CELL_COUNT)
        ]
        pack_v = sum(c["voltage"] for c in cells)
        return {
            "index": self.index,
            "temperature": round(self.temp, 1),
            "balancerConnected": True,
            "current": round(self.current, 2),
            "power": round(pack_v * self.current, 2),
            "cells": cells,
        }


packs = [Pack(i + 1) for i in range(PACK_COUNT)]


def on_connect(client, userdata, flags, rc, *args):
    print("[MQTT] Connected" if rc == 0 else f"[MQTT] Connect failed rc={rc}")


try:
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1, client_id=f"bms-sim-{DEVICE_ID}")
except AttributeError:
    client = mqtt.Client(client_id=f"bms-sim-{DEVICE_ID}")

client.username_pw_set(USERNAME, PASSWORD)
client.on_connect = on_connect
client.reconnect_delay_set(min_delay=1, max_delay=30)

print(f"[MQTT] {BROKER}:{PORT} as {USERNAME} -> {TOPIC} ({PACK_COUNT} pack x {CELL_COUNT} cell)")
client.connect(BROKER, PORT, keepalive=60)
client.loop_start()

try:
    while True:
        payload = {"timestamp": int(time.time() * 1000), "packs": [p.step() for p in packs]}
        msg = json.dumps(payload)
        info = client.publish(TOPIC, msg, qos=1)
        summary = " | ".join(
            f"P{pk['index']} I={pk['current']:+.2f}A "
            f"Δ={(max(c['voltage'] for c in pk['cells']) - min(c['voltage'] for c in pk['cells'])) * 1000:.0f}mV"
            for pk in payload["packs"]
        )
        print(f"[{time.strftime('%H:%M:%S')}] rc={info.rc} {len(msg)}B {summary}")
        time.sleep(INTERVAL)
except KeyboardInterrupt:
    print("\n[SYSTEM] Stopping...")
finally:
    client.loop_stop()
    client.disconnect()