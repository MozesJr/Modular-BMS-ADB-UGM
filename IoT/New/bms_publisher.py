#!/usr/bin/env python3
"""
Raspberry Pi -> MQTT publisher for JK-BMS.

Reads real data from one or more JK-BMS units over UART (jkbms.py) and publishes
it to bms/{DEVICE_ID}/data using the SAME payload contract as the simulator:

{
  "timestamp": <ms>,
  "packs": [
    {
      "index": 1,
      "temperature": 27.0,
      "balancerConnected": true,
      "current": 1.23,          # + = discharge, - = charge
      "power": 15.6,
      "soc": 69,                # % from BMS coulomb counter (optional)
      "remainingCapacity": 20.7,# Ah = capacity * soc / 100 (optional)
      "capacity": 30.0,         # Ah, BMS capacity setting (optional)
      "balancing": false,       # balancer actively balancing now (optional)
      "cells": [{"index": 1, "voltage": 3.301}, ...]
    }
  ]
}

1 JK-BMS = 1 pack. Multiple packs = multiple serial ports (SERIAL_PORTS, comma-separated).
"""

import json
import logging
import os
import sys
import time
from typing import Any, Dict, List, Optional

import paho.mqtt.client as mqtt
import serial

from jkbms import JKBMS

# ------------------------------------------------------------------ config

BROKER = os.environ.get("MQTT_BROKER_HOST", "72.61.208.150")
PORT = int(os.environ.get("MQTT_BROKER_PORT", "1883"))
USERNAME = os.environ.get("MQTT_USERNAME", "esp32_device")
PASSWORD = os.environ.get(
    "MQTT_PASSWORD", ""
)  # no default: set via env / EnvironmentFile
DEVICE_ID = os.environ.get("DEVICE_ID", "GAMA-BMS-PACK-001")
INTERVAL = int(
    os.environ.get("PUBLISH_INTERVAL", "10")
)  # seconds between MQTT publishes

SERIAL_PORTS = [
    p.strip()
    for p in os.environ.get("SERIAL_PORTS", "/dev/serial0").split(",")
    if p.strip()
]
BAUDRATE = int(os.environ.get("BMS_BAUDRATE", "115200"))
REQUEST_INTERVAL = float(
    os.environ.get("BMS_REQUEST_INTERVAL", "2")
)  # seconds between UART requests
STALE_AFTER = float(
    os.environ.get("BMS_STALE_AFTER", str(max(3 * REQUEST_INTERVAL, 15)))
)
BMS_DEBUG = os.environ.get("BMS_DEBUG", "0") == "1"

TOPIC = f"bms/{DEVICE_ID}/data"

logging.basicConfig(
    level=logging.DEBUG if BMS_DEBUG else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("publisher")

if not PASSWORD:
    sys.exit("MQTT_PASSWORD wajib diisi lewat environment")


# ------------------------------------------------------------------ BMS side


class PackReader:
    """Wraps one JK-BMS on one serial port, with auto-reconnect."""

    RECONNECT_DELAY = 5.0

    def __init__(self, index: int, port: str):
        self.index = index
        self.port = port
        self.bms = JKBMS(
            port=port,
            baudrate=BAUDRATE,
            request_interval=REQUEST_INTERVAL,
            debug=BMS_DEBUG,
        )
        self.connected = False
        self.next_retry = 0.0
        self.latest: Optional[Dict[str, Any]] = None

    def _connect(self):
        try:
            self.bms.connect()
            self.connected = True
            log.info("Pack %d connected on %s", self.index, self.port)
        except (serial.SerialException, OSError) as exc:
            self.connected = False
            self.next_retry = time.monotonic() + self.RECONNECT_DELAY
            log.warning(
                "Pack %d: cannot open %s (%s); retry in %.0fs",
                self.index,
                self.port,
                exc,
                self.RECONNECT_DELAY,
            )

    def poll(self):
        if not self.connected:
            if time.monotonic() >= self.next_retry:
                self._connect()
            return
        try:
            snap = self.bms.read()
            if snap:
                self.latest = snap
        except (serial.SerialException, OSError) as exc:
            log.warning(
                "Pack %d: serial error on %s (%s); reconnecting",
                self.index,
                self.port,
                exc,
            )
            self.bms.close()
            self.connected = False
            self.next_retry = time.monotonic() + self.RECONNECT_DELAY

    def fresh_snapshot(self) -> Optional[Dict[str, Any]]:
        if not self.latest or not self.latest.get("valid"):
            return None
        if time.time() - (self.latest.get("timestamp") or 0) > STALE_AFTER:
            return None
        return self.latest

    def close(self):
        self.bms.close()


def to_pack_payload(index: int, snap: Dict[str, Any]) -> Dict[str, Any]:
    """Map a JK-BMS snapshot to the dashboard pack contract."""
    cells = [
        {"index": int(no), "voltage": round(v, 3)}
        for no, v in sorted(snap["cell_voltages"].items())
    ]
    current = snap.get("current") or 0.0
    pack_v = snap.get("voltage") or sum(c["voltage"] for c in cells)
    temp = snap.get("battery_temp")
    if temp is None:
        temp = snap.get("box_temp")

    soc = snap.get("soc")
    capacity = snap.get("capacity_ah") or snap.get("actual_capacity_ah")
    remaining = (
        round(capacity * soc / 100, 1)
        if capacity is not None and soc is not None
        else None
    )

    return {
        "index": index,
        "temperature": round(temp, 1) if temp is not None else None,
        "balancerConnected": True,  # JK-BMS has a built-in active balancer
        "current": round(current, 2),
        "power": round(pack_v * current, 2),
        "soc": soc,
        "remainingCapacity": remaining,
        "capacity": float(capacity) if capacity is not None else None,
        "balancing": snap.get("balancing"),
        "cells": cells,
    }


# ------------------------------------------------------------------ MQTT side


def on_connect(client, userdata, flags, rc, *args):
    if rc == 0:
        log.info("[MQTT] Connected to %s:%d", BROKER, PORT)
    else:
        log.error("[MQTT] Connect failed rc=%s", rc)


def on_disconnect(client, userdata, *args):
    log.warning("[MQTT] Disconnected; paho will auto-reconnect")


def make_client() -> mqtt.Client:
    try:
        client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION1, client_id=f"bms-raspi-{DEVICE_ID}"
        )
    except AttributeError:
        client = mqtt.Client(client_id=f"bms-raspi-{DEVICE_ID}")
    client.username_pw_set(USERNAME, PASSWORD)
    client.on_connect = on_connect
    client.on_disconnect = on_disconnect
    client.reconnect_delay_set(min_delay=1, max_delay=30)
    return client


# ------------------------------------------------------------------ main loop


def main():
    readers: List[PackReader] = [
        PackReader(i + 1, port) for i, port in enumerate(SERIAL_PORTS)
    ]

    client = make_client()
    log.info(
        "[MQTT] %s:%d as %s -> %s (%d pack: %s)",
        BROKER,
        PORT,
        USERNAME,
        TOPIC,
        len(readers),
        ", ".join(SERIAL_PORTS),
    )

    # connect_async + loop_start: tidak crash kalau broker belum bisa dijangkau saat boot
    client.connect_async(BROKER, PORT, keepalive=60)
    client.loop_start()

    last_publish = 0.0
    try:
        while True:
            for r in readers:
                r.poll()

            now = time.monotonic()
            if now - last_publish < INTERVAL:
                time.sleep(0.05)
                continue
            last_publish = now

            packs = []
            for r in readers:
                snap = r.fresh_snapshot()
                if snap is None:
                    log.warning(
                        "Pack %d (%s): no fresh data, skipped this cycle",
                        r.index,
                        r.port,
                    )
                    continue
                packs.append(to_pack_payload(r.index, snap))

            if not packs:
                log.warning("No pack data available; nothing published")
                continue

            payload = {"timestamp": int(time.time() * 1000), "packs": packs}
            msg = json.dumps(payload)
            info = client.publish(TOPIC, msg, qos=1)

            summary = " | ".join(
                f"P{pk['index']} {len(pk['cells'])}S SOC={pk['soc']}% I={pk['current']:+.2f}A T={pk['temperature']}°C "
                f"Δ={(max(c['voltage'] for c in pk['cells']) - min(c['voltage'] for c in pk['cells'])) * 1000:.0f}mV"
                for pk in packs
                if pk["cells"]
            )
            log.info("publish rc=%s %dB %s", info.rc, len(msg), summary)

    except KeyboardInterrupt:
        log.info("[SYSTEM] Stopping...")
    finally:
        client.loop_stop()
        client.disconnect()
        for r in readers:
            r.close()


if __name__ == "__main__":
    main()
