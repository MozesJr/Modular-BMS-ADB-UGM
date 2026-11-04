#!/usr/bin/env python3
"""
Python adaptation of chrissank/JKBMSInterface.
Read-only JK-BMS UART protocol v2.5 implementation.

Frame layout (response):
  4E 57 | len(2) | terminal(4) | cmd(1) | source(1) | type(1) |  <- header, 11 bytes
  data fields (ID + fixed-length payload, 0x79 = variable cell list)
  record no.(4) | 0x68 | 00 00 | checksum(2)                     <- trailer, 9 bytes
"""

import time
import logging
from typing import Optional, Dict, Any

import serial

READ_ALL_COMMAND = bytes(
    [
        0x4E,
        0x57,
        0x00,
        0x13,
        0x00,
        0x00,
        0x00,
        0x00,
        0x06,
        0x03,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x68,
        0x00,
        0x00,
        0x01,
        0x29,
    ]
)

# JK-BMS protocol v2.5: fixed payload length per data ID (0x79 is variable, handled separately)
FIELD_LEN = {
    0x80: 2,
    0x81: 2,
    0x82: 2,
    0x83: 2,
    0x84: 2,
    0x85: 1,
    0x86: 1,
    0x87: 2,
    0x89: 4,
    0x8A: 2,
    0x8B: 2,
    0x8C: 2,
    0x8E: 2,
    0x8F: 2,
    0x90: 2,
    0x91: 2,
    0x92: 2,
    0x93: 2,
    0x94: 2,
    0x95: 2,
    0x96: 2,
    0x97: 2,
    0x98: 2,
    0x99: 2,
    0x9A: 2,
    0x9B: 2,
    0x9C: 2,
    0x9D: 1,
    0x9E: 2,
    0x9F: 2,
    0xA0: 2,
    0xA1: 2,
    0xA2: 2,
    0xA3: 2,
    0xA4: 2,
    0xA5: 2,
    0xA6: 2,
    0xA7: 2,
    0xA8: 2,
    0xA9: 1,
    0xAA: 4,
    0xAB: 1,
    0xAC: 1,
    0xAD: 2,
    0xAE: 1,
    0xAF: 1,
    0xB0: 2,
    0xB1: 1,
    0xB2: 10,
    0xB3: 1,
    0xB4: 8,
    0xB5: 4,
    0xB6: 4,
    0xB7: 15,
    0xB8: 1,
    0xB9: 4,
    0xBA: 24,
    0xBB: 1,
    0xBC: 1,
    0xBD: 1,
    0xBE: 1,
    0xBF: 2,
    0xC0: 1,
}
HEADER_LEN = 11  # 4E57 + len(2) + terminal(4) + cmd + source + type
TRAILER_LEN = 9  # record no.(4) + 0x68 + checksum(4)


class JKBMS:
    def __init__(
        self,
        port: str = "/dev/serial0",
        baudrate: int = 115200,
        timeout: float = 0.2,
        request_interval: float = 5.0,
        max_cells: int = 24,
        debug: bool = False,
    ):
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
        self.request_interval = request_interval
        self.max_cells = max_cells
        self.log = logging.getLogger("JKBMS")
        self.debug = debug
        self.ser: Optional[serial.Serial] = None
        self.last_request = 0.0
        self.buffer = bytearray()
        self.data: Dict[str, Any] = {}
        self._reset_data()

    def _reset_data(self):
        self.data = {
            "valid": False,
            "timestamp": None,
            "voltage": None,
            "current": None,  # positive=discharge, negative=charge (source library convention)
            "soc": None,
            "cycles": None,
            "power_temp": None,
            "box_temp": None,
            "battery_temp": None,
            "cell_count": 0,
            "cell_voltages": {},
            "lowest_cell_voltage": None,
            "highest_cell_voltage": None,
            "cell_voltage_delta": None,
            "alarm_status": None,
            "status_info": None,
            "charge_mos_enabled": None,
            "discharge_mos_enabled": None,
            "charging": None,
            "discharging": None,
            "balancing": None,  # balancer actively balancing right now (status bit2)
            "capacity_ah": None,  # 0xAA battery capacity setting (Ah)
            "actual_capacity_ah": None,  # 0xB9 actual battery capacity (Ah)
            "software_version": None,
            "device_info": None,
            "protocol_version": 1,
            "raw_frame": None,
        }

    # ------------------------------------------------------------------ serial

    def connect(self):
        self.ser = serial.Serial(
            port=self.port,
            baudrate=self.baudrate,
            bytesize=serial.EIGHTBITS,
            parity=serial.PARITY_NONE,
            stopbits=serial.STOPBITS_ONE,
            timeout=self.timeout,
            write_timeout=1,
        )
        self.ser.reset_input_buffer()
        self.log.info("Connected to JK-BMS UART on %s", self.port)

    def close(self):
        if self.ser and self.ser.is_open:
            self.ser.close()

    def request_data(self):
        if not self.ser or not self.ser.is_open:
            raise RuntimeError("Serial port is not connected")
        self.ser.write(READ_ALL_COMMAND)
        self.ser.flush()
        self.last_request = time.monotonic()
        self.log.debug("Sent read-all request: %s", READ_ALL_COMMAND.hex(" "))

    # ----------------------------------------------------------------- helpers

    @staticmethod
    def _temperature(raw: int) -> Optional[float]:
        t = float(raw if raw <= 100 else -(raw - 100))
        return None if t <= -40 else t  # -40°C (raw 140) = probe not connected

    @staticmethod
    def _ascii(raw: bytes) -> str:
        return "".join(chr(x) for x in raw if 0x20 <= x <= 0x7E).strip()

    def _extract_frames(self):
        frames = []
        while True:
            start = self.buffer.find(b"\x4e\x57")
            if start < 0:
                # Preserve a possible partial header.
                self.buffer[:] = (
                    self.buffer[-1:] if self.buffer.endswith(b"\x4e") else b""
                )
                break
            if start:
                del self.buffer[:start]
            if len(self.buffer) < 4:
                break

            frame_length = (self.buffer[2] << 8) | self.buffer[3]
            total_length = frame_length + 2
            if total_length < HEADER_LEN + TRAILER_LEN or total_length > 1024:
                del self.buffer[0]
                continue
            if len(self.buffer) < total_length:
                break

            frame = bytes(self.buffer[:total_length])
            del self.buffer[:total_length]
            frames.append(frame)
        return frames

    @staticmethod
    def _checksum_ok(frame: bytes) -> bool:
        # JK frame trailer: 00 00 followed by 16-bit additive checksum.
        if len(frame) < 6 or frame[-4:-2] != b"\x00\x00":
            return False
        expected = int.from_bytes(frame[-2:], "big")
        calculated = sum(frame[:-4]) & 0xFFFF
        return calculated == expected

    # ------------------------------------------------------------------ parser

    def _parse_frame(self, frame: bytes) -> Optional[Dict[str, Any]]:
        if not frame.startswith(b"\x4e\x57"):
            self.log.debug("Unexpected frame structure: %s", frame.hex(" "))
            return None
        if not self._checksum_ok(frame):
            self.log.warning("Checksum mismatch; frame discarded: %s", frame.hex(" "))
            return None
        if len(frame) < HEADER_LEN + TRAILER_LEN or frame[-5] != 0x68:
            self.log.warning(
                "End marker 0x68 not at expected position: %s", frame.hex(" ")
            )
            return None

        # Work on a fresh snapshot; never publish partially parsed data.
        parsed = dict(self.data)
        parsed.update(
            {
                "valid": False,
                "timestamp": time.time(),
                "cell_count": 0,
                "cell_voltages": {},
                "raw_frame": frame.hex(" "),
            }
        )

        data = frame[HEADER_LEN : len(frame) - TRAILER_LEN]
        pos, end = 0, len(data)
        current_raw = None

        def u(p: int, n: int) -> int:
            return int.from_bytes(data[p : p + n], "big")

        while pos < end:
            data_id = data[pos]
            pos += 1

            if data_id == 0x79:  # cell list: len + n*(cell_no, mV u16)
                if pos >= end:
                    self.log.warning("Missing cell-list length")
                    break
                length = data[pos]
                pos += 1
                cell_end = min(pos + length, end)
                while pos + 3 <= cell_end:
                    cell_no, mv = data[pos], u(pos + 1, 2)
                    if 1 <= cell_no <= self.max_cells and mv > 0:
                        parsed["cell_voltages"][cell_no] = mv / 1000.0
                    pos += 3
                pos = cell_end
                continue

            n = FIELD_LEN.get(data_id)
            if n is None:
                # Unknown ID = length unknown; stop here instead of desyncing.
                self.log.warning(
                    "Unknown data ID 0x%02X at frame offset %d; rest of frame ignored",
                    data_id,
                    pos - 1 + HEADER_LEN,
                )
                break
            if pos + n > end:
                self.log.warning("Truncated field 0x%02X", data_id)
                break

            v = u(pos, n)
            if data_id == 0x80:
                parsed["power_temp"] = self._temperature(v)
            elif data_id == 0x81:
                parsed["box_temp"] = self._temperature(v)
            elif data_id == 0x82:
                parsed["battery_temp"] = self._temperature(v)
            elif data_id == 0x83:
                parsed["voltage"] = v * 0.01
            elif data_id == 0x84:
                current_raw = v
            elif data_id == 0x85:
                parsed["soc"] = v
            elif data_id == 0x87:
                parsed["cycles"] = v
            elif data_id == 0x8B:
                parsed["alarm_status"] = v
            elif data_id == 0x8C:
                parsed["status_info"] = v
            elif data_id == 0xAA:
                parsed["capacity_ah"] = v
            elif data_id == 0xB9:
                parsed["actual_capacity_ah"] = v
            elif data_id == 0xB7:
                parsed["software_version"] = self._ascii(data[pos : pos + n])
            elif data_id == 0xBA:
                parsed["device_info"] = self._ascii(data[pos : pos + n])
            elif data_id == 0xC0:
                parsed["protocol_version"] = v
                pos += n
                if pos < end:
                    self.log.debug(
                        "Extra bytes after 0xC0 (newer firmware), ignored: %s",
                        data[pos:end].hex(" "),
                    )
                break  # 0xC0 = last documented field
            pos += n

        parsed["cell_count"] = max(parsed["cell_voltages"], default=0)

        if current_raw is not None:
            if parsed.get("protocol_version", 1) == 0:
                # Offset format: 10000 = 0 A
                current = (
                    0.0 if current_raw in (0, 10000) else (current_raw - 10000) * 0.01
                )
            else:
                # Sign-bit format: bit15 = direction, bits0-14 = value in 10 mA
                current = (
                    -(current_raw & 0x7FFF) * 0.01
                    if current_raw & 0x8000
                    else current_raw * 0.01
                )
            parsed["current"] = current

        cells = list(parsed["cell_voltages"].values())
        if cells:
            parsed["lowest_cell_voltage"] = min(cells)
            parsed["highest_cell_voltage"] = max(cells)
            parsed["cell_voltage_delta"] = max(cells) - min(cells)

        status = parsed.get("status_info")
        current = parsed.get("current")
        if status is not None:
            parsed["charge_mos_enabled"] = bool(status & 0x01)
            parsed["discharge_mos_enabled"] = bool(status & 0x02)
            parsed["balancing"] = bool(status & 0x04)
        if current is not None:
            parsed["charging"] = current < -0.01
            parsed["discharging"] = current > 0.01

        parsed["valid"] = parsed["voltage"] is not None and bool(cells)
        if not parsed["valid"]:
            self.log.warning(
                "Frame parsed but missing voltage/cells: %s", frame.hex(" ")
            )
            return None

        self.data = parsed
        return dict(parsed)

    # -------------------------------------------------------------- public API

    def read(self) -> Optional[Dict[str, Any]]:
        """Send periodic request, collect bytes, and return newest valid snapshot."""
        if not self.ser or not self.ser.is_open:
            raise RuntimeError("Call connect() before read()")

        now = time.monotonic()
        if now - self.last_request >= self.request_interval:
            self.request_data()

        waiting = self.ser.read(self.ser.in_waiting or 1)
        if waiting:
            self.buffer.extend(waiting)
            if len(self.buffer) > 4096:
                self.log.warning("Receive buffer overflow; clearing buffer")
                self.buffer.clear()

        latest = None
        for frame in self._extract_frames():
            if self.debug:
                self.log.debug("RX: %s", frame.hex(" "))
            result = self._parse_frame(frame)
            if result is not None:
                latest = result
        return latest

    def get_data(self) -> Dict[str, Any]:
        return dict(self.data)


if __name__ == "__main__":
    # Quick standalone test: python3 jkbms.py
    logging.basicConfig(
        level=logging.DEBUG,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    bms = JKBMS(debug=True)
    bms.connect()
    try:
        while True:
            snap = bms.read()
            if snap:
                print(
                    f"V={snap['voltage']:.2f}V  I={snap['current']}A  SOC={snap['soc']}%  "
                    f"cells={snap['cell_count']}  dV={snap['cell_voltage_delta']:.3f}V  "
                    f"T={snap['battery_temp']}°C"
                )
                print(
                    "  cells:",
                    {k: round(v, 3) for k, v in sorted(snap["cell_voltages"].items())},
                )
    except KeyboardInterrupt:
        pass
    finally:
        bms.close()
