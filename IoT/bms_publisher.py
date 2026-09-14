import json
import time
import random
import paho.mqtt.client as mqtt

# =========================================================
# KONFIGURASI MQTT
# =========================================================

BROKER = "72.61.208.150"
PORT = 1883

USERNAME = "backend_service"
PASSWORD = "BmsAdbUgm2026#"

DEVICE_ID = "GAMA-BMS-PACK-001"

TOPIC = f"bms/{DEVICE_ID}/data"

# Interval pengiriman dummy
PUBLISH_INTERVAL = 60

# =========================================================
# KONFIGURASI PACK — 1 pack, 24 cell seri
# =========================================================

CELL_COUNT = 24

# Range voltage per cell. Dihitung dari formula SOC asli di FE (PackCard.tsx):
# percent = ((avgCellVoltage - 3.0) / 1.2) * 100  [domain 3.0-4.2V, generik Li-ion]
# 3.55-3.65V -> SOC 45.8%-54.2% (avg 3.6V -> tepat 50%). MAX dikunci di 3.65V,
# batas aman LiFePO4 yang sama dipakai di annotation chart & zona gauge cell —
# jangan dinaikkan lagi tanpa update batas aman itu juga.
CELL_VOLTAGE_MIN = 3.55
CELL_VOLTAGE_MAX = 3.65

CURRENT_RANGE = 5.0  # ACS712-05B, ±5A


# =========================================================
# MQTT CALLBACK
# =========================================================


def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print("[MQTT] Connected")
    else:
        print(f"[MQTT] Connection failed, rc={rc}")


def on_disconnect(client, userdata, rc):
    print(f"[MQTT] Disconnected, rc={rc}")


def on_publish(client, userdata, mid):
    print(f"[MQTT] Published, mid={mid}")


# =========================================================
# BUAT DUMMY DATA BMS
# =========================================================


def create_dummy_data():

    cells = []

    for i in range(1, CELL_COUNT + 1):
        voltage = round(random.uniform(CELL_VOLTAGE_MIN, CELL_VOLTAGE_MAX), 3)
        cells.append({"index": i, "voltage": voltage})

    temperature = round(random.uniform(24.0, 28.0), 1)
    balancer_connected = True
    current = round(random.uniform(-CURRENT_RANGE, CURRENT_RANGE), 2)

    data = {
        "temperature": temperature,
        "balancerConnected": balancer_connected,
        "cells": cells,
        "current": current,
    }

    return data


# =========================================================
# BUAT PAYLOAD MQTT
# =========================================================


def create_payload():

    bms_data = create_dummy_data()

    pack_voltage = sum(c["voltage"] for c in bms_data["cells"])
    power = round(pack_voltage * bms_data["current"], 2)

    payload = {
        "timestamp": int(time.time() * 1000),
        "packs": [
            {
                "index": 1,
                "temperature": bms_data["temperature"],
                "balancerConnected": bms_data["balancerConnected"],
                "current": bms_data["current"],
                "power": power,
                "cells": bms_data["cells"],
            }
        ],
    }

    return payload


# =========================================================
# MQTT CLIENT
# =========================================================

client = mqtt.Client(client_id=f"bms-python-{DEVICE_ID}")
client.username_pw_set(USERNAME, PASSWORD)
client.on_connect = on_connect
client.on_disconnect = on_disconnect
client.on_publish = on_publish

print(f"[MQTT] Connecting to {BROKER}:{PORT}")

try:
    client.connect(BROKER, PORT, keepalive=60)
except Exception as e:
    print(f"[MQTT] Connection error: {e}")
    exit(1)

client.loop_start()
time.sleep(1)

try:
    while True:
        payload = create_payload()
        message = json.dumps(payload)

        print()
        print("========================================")
        print("DUMMY BMS DATA")
        print("========================================")
        print(json.dumps(payload, indent=4))
        print("========================================")
        print("MQTT PUBLISH")
        print("========================================")
        print(f"Topic   : {TOPIC}")
        print(f"Payload : {message}")
        print("========================================")

        if not client.is_connected():
            print("[MQTT] Not connected")
            try:
                print("[MQTT] Trying reconnect...")
                client.reconnect()
            except Exception as e:
                print(f"[MQTT] Reconnect failed: {e}")
                time.sleep(PUBLISH_INTERVAL)
                continue

        result = client.publish(TOPIC, message, qos=1)

        if result.rc == mqtt.MQTT_ERR_SUCCESS:
            print("[MQTT] Publish success")
            try:
                result.wait_for_publish(timeout=5)
            except Exception:
                pass
        else:
            print(f"[MQTT] Publish failed, rc={result.rc}")

        print(f"[SYSTEM] Next data in {PUBLISH_INTERVAL} seconds...")
        time.sleep(PUBLISH_INTERVAL)

except KeyboardInterrupt:
    print()
    print("[SYSTEM] Stopping...")

finally:
    client.loop_stop()
    client.disconnect()
    print("[MQTT] Disconnected")
    print("[SYSTEM] Done")
