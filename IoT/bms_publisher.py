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

DEVICE_ID = "1"

TOPIC = f"bms/{DEVICE_ID}/data"

# Interval pengiriman dummy
PUBLISH_INTERVAL = 60


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

    # Dummy 6S LiFePO4
    for i in range(1, 7):

        voltage = round(
            random.uniform(3.28, 3.35),
            3
        )

        cells.append({
            "index": i,
            "voltage": voltage
        })


    # Temperature dummy
    temperature = round(
        random.uniform(24.0, 28.0),
        1
    )


    # Status balancer dummy
    balancer_connected = True


    # Struktur data BMS
    data = {
        "temperature": temperature,

        "balancerConnected": balancer_connected,

        "cells": cells
    }


    return data


# =========================================================
# BUAT PAYLOAD MQTT
# =========================================================

def create_payload():

    # Anggap ini adalah data yang nanti
    # berasal dari serial Raspberry Pi
    bms_data = create_dummy_data()


    payload = {

        "timestamp": int(
            time.time() * 1000
        ),

        "packs": [

            {
                "index": 1,

                "temperature": bms_data[
                    "temperature"
                ],

                "balancerConnected": bms_data[
                    "balancerConnected"
                ],

                "cells": bms_data[
                    "cells"
                ]
            }

        ]
    }


    return payload


# =========================================================
# MQTT CLIENT
# =========================================================

client = mqtt.Client(
    client_id=f"bms-python-{DEVICE_ID}"
)


client.username_pw_set(
    USERNAME,
    PASSWORD
)


client.on_connect = on_connect
client.on_disconnect = on_disconnect
client.on_publish = on_publish


# =========================================================
# CONNECT MQTT
# =========================================================

print(
    f"[MQTT] Connecting to "
    f"{BROKER}:{PORT}"
)


try:

    client.connect(
        BROKER,
        PORT,
        keepalive=60
    )

except Exception as e:

    print(
        f"[MQTT] Connection error: {e}"
    )

    exit(1)


# Jalankan MQTT network loop
client.loop_start()


# Tunggu koneksi
time.sleep(1)


# =========================================================
# LOOP PENGIRIMAN DATA
# =========================================================

try:

    while True:

        # -------------------------------------------------
        # Buat dummy data
        # -------------------------------------------------

        payload = create_payload()


        # -------------------------------------------------
        # Convert JSON
        # -------------------------------------------------

        message = json.dumps(
            payload
        )


        # -------------------------------------------------
        # Tampilkan data
        # -------------------------------------------------

        print()
        print("========================================")
        print("DUMMY BMS DATA")
        print("========================================")

        print(
            json.dumps(
                payload,
                indent=4
            )
        )

        print("========================================")
        print("MQTT PUBLISH")
        print("========================================")

        print(
            f"Topic   : {TOPIC}"
        )

        print(
            f"Payload : {message}"
        )

        print("========================================")


        # -------------------------------------------------
        # Pastikan MQTT masih connected
        # -------------------------------------------------

        if not client.is_connected():

            print(
                "[MQTT] Not connected"
            )

            try:

                print(
                    "[MQTT] Trying reconnect..."
                )

                client.reconnect()

            except Exception as e:

                print(
                    f"[MQTT] Reconnect failed: {e}"
                )

                time.sleep(
                    PUBLISH_INTERVAL
                )

                continue


        # -------------------------------------------------
        # Publish
        # -------------------------------------------------

        result = client.publish(
            TOPIC,
            message,
            qos=1
        )


        if result.rc == mqtt.MQTT_ERR_SUCCESS:

            print(
                "[MQTT] Publish success"
            )

            try:

                result.wait_for_publish(
                    timeout=5
                )

            except Exception:
                pass

        else:

            print(
                f"[MQTT] Publish failed, "
                f"rc={result.rc}"
            )


        # -------------------------------------------------
        # Tunggu sebelum data berikutnya
        # -------------------------------------------------

        print(
            f"[SYSTEM] Next data in "
            f"{PUBLISH_INTERVAL} seconds..."
        )

        time.sleep(
            PUBLISH_INTERVAL
        )


# =========================================================
# STOP PROGRAM
# =========================================================

except KeyboardInterrupt:

    print()
    print(
        "[SYSTEM] Stopping..."
    )


finally:

    client.loop_stop()

    client.disconnect()

    print(
        "[MQTT] Disconnected"
    )

    print(
        "[SYSTEM] Done"
    )