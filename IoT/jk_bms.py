#!/usr/bin/env python3
"""
Python adaptation of chrissank/JKBMSInterface.
Read-only JK-BMS UART protocol v2.5 implementation.
"""
import time
import logging
from typing import Optional, Dict, Any

import serial


READ_ALL_COMMAND = bytes([
    0x4E, 0x57, 0x00, 0x13, 0x00, 0x00, 0x00, 0x00,
    0x06, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x68, 0x00, 0x00, 0x01, 0x29
])


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
            "software_version": None,
            "device_info": None,
            "protocol_version": 1,
            "raw_frame": None,
        }

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

    @staticmethod
    def _u16(buf: bytearray, pos: int) -> int:
        return (buf[pos] << 8) | buf[pos + 1]

    @staticmethod
    def _temperature(raw: int) -> float:
        return float(raw if raw <= 100 else -(raw - 100))

    def _extract_frames(self):
        frames = []
        while True:
            start = self.buffer.find(b"\x4e\x57")
            if start < 0:
                # Preserve a possible partial header.
                self.buffer[:] = self.buffer[-1:] if self.buffer.endswith(b"\x4e") else b""
                break
            if start:
                del self.buffer[:start]
            if len(self.buffer) < 4:
                break

            frame_length = (self.buffer[2] << 8) | self.buffer[3]
            total_length = frame_length + 2
            if total_length < 21 or total_length > 1024:
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

    def _parse_frame(self, frame: bytes) -> Optional[Dict[str, Any]]:
        if not frame.startswith(b"\x4e\x57"):
            self.log.debug("Unexpected frame structure: %s", frame.hex(" "))
            return None
        if not self._checksum_ok(frame):
            self.log.warning("Checksum mismatch; frame discarded: %s", frame.hex(" "))
            return None

        # Work on a fresh snapshot; never publish partially parsed data.
        parsed = dict(self.data)
        parsed.update({
            "valid": False,
            "timestamp": time.time(),
            "cell_count": 0,
            "cell_voltages": {},
            "raw_frame": frame.hex(" "),
        })
        pos = 11
        end = len(frame) - 4
        current_raw = None
        found_end = False

        try:
            while pos < end:
                data_id = frame[pos]
                pos += 1

                if data_id == 0x79:  # Cell list: length + (cell number, mV) tuples
                    if pos >= end:
                        raise ValueError("Missing cell-list length")
                    length = frame[pos]
                    pos += 1
                    cell_end = min(pos + length, end)
                    while pos + 3 <= cell_end:
                        cell_no = frame[pos]
                        mv = self._u16(frame, pos + 1)
                        pos += 3
                        if 1 <= cell_no <= self.max_cells and mv > 0:
                            parsed["cell_voltages"][cell_no] = mv / 1000.0
                    pos = cell_end
                    parsed["cell_count"] = max(parsed["cell_voltages"], default=0)

                elif data_id in (0x80, 0x81, 0x82, 0x83, 0x84, 0x87, 0x8B, 0x8C, 0xC0):
                    if pos + 2 > end:
                        raise ValueError(f"Truncated field 0x{data_id:02X}")
                    value = self._u16(frame, pos)
                    pos += 2
                    if data_id == 0x80:
                        parsed["power_temp"] = self._temperature(value)
                    elif data_id == 0x81:
                        parsed["box_temp"] = self._temperature(value)
                    elif data_id == 0x82:
                        parsed["battery_temp"] = self._temperature(value)
                    elif data_id == 0x83:
                        parsed["voltage"] = value * 0.01
                    elif data_id == 0x84:
                        current_raw = value
                    elif data_id == 0x87:
                        parsed["cycles"] = value
                    elif data_id == 0x8B:
                        parsed["alarm_status"] = value
                    elif data_id == 0x8C:
                        parsed["status_info"] = value
                    elif data_id == 0xC0:
                        parsed["protocol_version"] = value

                elif data_id == 0x85:  # SOC
                    if pos >= end:
                        raise ValueError("Truncated SOC")
                    parsed["soc"] = frame[pos]
                    pos += 1

                elif data_id == 0x86:  # Temperature sensor count
                    if pos >= end:
                        raise ValueError("Truncated sensor count")
                    pos += 1

                elif data_id == 0xB7:  # 15-byte firmware field
                    raw = frame[pos:min(pos + 15, end)]
                    parsed["software_version"] = "".join(
                        chr(x) for x in raw if 0x20 <= x <= 0x7E
                    ).strip()
                    pos += min(15, end - pos)

                elif data_id in (0xB4, 0xBA):  # NUL-terminated text
                    text_bytes = bytearray()
                    while pos < end and frame[pos] != 0:
                        text_bytes.append(frame[pos])
                        pos += 1
                    if pos < end and frame[pos] == 0:
                        pos += 1
                    if data_id == 0xBA:
                        parsed["device_info"] = text_bytes.decode("ascii", errors="replace")

                elif data_id == 0x68:
                    found_end = True
                    break

                else:
                    # Same fallback convention used by the Arduino source.
                    if 0x8E <= data_id <= 0xC0:
                        pos += 2
                    else:
                        pos += 1

            if not found_end:
                raise ValueError("Data end marker 0x68 not found")

            if current_raw is not None:
                protocol = parsed.get("protocol_version", 1)
                if protocol == 0:
                    if current_raw == 10000 or current_raw == 0:
                        current = 0.0
                    elif current_raw > 10000:
                        current = (current_raw - 10000) * 0.01
                    else:
                        current = -(10000 - current_raw) * 0.01
                else:
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
            if current is not None:
                parsed["charging"] = current < -0.01
                parsed["discharging"] = current > 0.01

            parsed["valid"] = True
            self.data = parsed
            return dict(parsed)

        except (IndexError, ValueError) as exc:
            self.log.warning("Could not parse JK-BMS frame: %s", exc)
            return None

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
