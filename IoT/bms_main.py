"""ADB BMS publisher (saat ini masih data SIMULASI).

Setelan MQTT dan interval diambil dari portal: /data/device-config/config.json
OLED dipegang portal; program ini hanya menitip baris teks lewat DISPLAY_PATH.
"""
import json
import os
import random
import time

import paho.mqtt.client as mqtt

CONFIG_PATH = os.environ.get("BMS_CONFIG", "/data/device-config/config.json")
DISPLAY_PATH = os.environ.get("BMS_DISPLAY", "/run/bms-display.json")
PACK_COUNT = int(os.environ.get("PACK_COUNT", "1"))
CELL_COUNT = int(os.environ.get("CELL_COUNT", "24"))      # cell per pack

V_MIN, V_MAX = 3.20, 3.45
CELL_OFFSET_MV = 8
CURRENT_MAX = 5.0


def load_config():
    try:
        with open(CONFIG_PATH) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def show(lines):
    """Titip maksimal 4 baris ke OLED (baris ke-5 diisi portal dengan alamat IP)."""
    try:
        tmp = DISPLAY_PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump(lines, f)
        os.replace(tmp, DISPLAY_PATH)
    except OSError as e:
        print(f"[OLED] {e}")


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


def oled_lines(payload, online):
    lines = ["BMS MONITOR" if online else "BMS (MQTT putus)"]
    for pack in payload["packs"]:
        volts = [c["voltage"] for c in pack["cells"]]
        delta_mv = (max(volts) - min(volts)) * 1000
        lines.append(f"P{pack['index']} I:{pack['current']:+.2f}A")
        lines.append(f"T:{pack['temperature']:.1f}C D:{delta_mv:.0f}mV")
    return lines[:4]


def main():
    # Tunggu sampai MQTT diisi lewat halaman setelan (mis. sehabis factory reset).
    while True:
        cfg = load_config()
        m = cfg.get("mqtt", {})
        if m.get("host"):
            break
        show(["BMS MONITOR", "MQTT belum diatur", "Buka halaman", "setelan alat"])
        time.sleep(5)

    topic = m.get("base_topic") or "bms/GAMA-BMS-PACK-001/data"
    parts = topic.split("/")
    device_id = parts[1] if len(parts) >= 2 else "bms"
    client_id = m.get("client_id") or device_id      # broker menolak client ID kosong
    interval = max(1, int(cfg.get("app", {}).get("interval_s", 10)))

    state = {"online": False}

    def on_connect(client, userdata, flags, rc, *args):
        state["online"] = rc == 0
        print("[MQTT] Connected" if rc == 0 else f"[MQTT] Connect failed rc={rc}")

    def on_disconnect(client, userdata, *args):
        state["online"] = False
        print("[MQTT] Disconnected")

    try:
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1, client_id=client_id)
    except AttributeError:
        client = mqtt.Client(client_id=client_id)
    if m.get("username"):
        client.username_pw_set(m["username"], m.get("password") or None)
    if m.get("tls"):
        client.tls_set()
    client.on_connect = on_connect
    client.on_disconnect = on_disconnect
    client.reconnect_delay_set(min_delay=1, max_delay=30)

    print(f"[MQTT] {m['host']}:{m.get('port', 1883)} as {m.get('username')} "
          f"id={client_id} -> {topic} tiap {interval}s ({PACK_COUNT} pack x {CELL_COUNT} cell)")
    # connect_async: tidak crash kalau WiFi belum siap, loop_start yang mengulang.
    client.connect_async(m["host"], int(m.get("port", 1883)), keepalive=60)
    client.loop_start()

    packs = [Pack(i + 1) for i in range(PACK_COUNT)]
    try:
        while True:
            payload = {"timestamp": int(time.time() * 1000), "packs": [p.step() for p in packs]}
            msg = json.dumps(payload)
            info = client.publish(topic, msg, qos=1)
            print(f"[{time.strftime('%H:%M:%S')}] rc={info.rc} {len(msg)}B online={state['online']}")
            # Perbarui titipan OLED tiap 5 dtk supaya portal tahu program ini masih hidup.
            waited = 0
            while waited < interval:
                show(oled_lines(payload, state["online"]))
                step = min(5, interval - waited)
                time.sleep(step)
                waited += step
    except KeyboardInterrupt:
        print("\n[SYSTEM] Stopping...")
    finally:
        try:
            os.remove(DISPLAY_PATH)
        except OSError:
            pass
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()
