from datetime import datetime
import time
from luma.core.interface.serial import i2c
from luma.core.render import canvas
from luma.oled.device import ssd1306

serial = i2c(port=1, address=0x3C)
device = ssd1306(serial, width=128, height=64)

try:
    while True:
        waktu_sekarang = datetime.now().strftime("%y%m%d-%H:%M")
        with canvas(device) as draw:
            draw.text((0, 2), "GAMA BMS", fill="white")
            draw.text((0, 18), "192.168.4.1", fill="white")
            draw.text((0, 34), "V Total: 78V", fill="white")
            draw.text((0, 50), f"time : {waktu_sekarang}", fill="white")
        time.sleep(1)
except KeyboardInterrupt:
    device.clear()