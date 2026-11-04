"""OLED I2C 128x64 lewat luma.oled. Kalau OLED tidak ada, semua jadi no-op."""
import logging

import settings as S

log = logging.getLogger("display")


class Display:
    def __init__(self):
        self.dev = None
        self._last = None
        if not S.OLED_ENABLED or S.MOCK:
            return
        try:
            from luma.core.interface.serial import i2c
            from luma.oled import device as drivers
            self.dev = getattr(drivers, S.OLED_DRIVER)(
                i2c(port=S.OLED_I2C_PORT, address=S.OLED_I2C_ADDR))
        except Exception as e:  # OLED opsional, jangan sampai service mati
            log.warning("OLED tidak aktif: %s", e)

    def show(self, lines):
        """Maksimal 5 baris x 21 karakter."""
        lines = [str(l)[:21] for l in lines[:5]]
        if lines == self._last:
            return
        self._last = lines
        if not self.dev:
            log.info("OLED: %s", " | ".join(lines))
            return
        try:
            from luma.core.render import canvas
            with canvas(self.dev) as draw:
                for i, line in enumerate(lines):
                    draw.text((0, i * 12), line, fill="white")
        except Exception as e:
            log.warning("OLED gagal gambar: %s", e)
