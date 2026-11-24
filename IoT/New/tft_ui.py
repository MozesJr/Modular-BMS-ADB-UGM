"""
TFT UI untuk JK-BMS publisher: layar ILI9341 (luma.lcd) + touch XPT2046.

- Halaman per pack: Summary & Cells. Geser kiri/kanan untuk pindah, atau auto-rotate.
- Screensaver (mata robot / orang joget) setelah idle; sentuh untuk kembali ke Summary.
- Semua akses ke layar terjadi di thread UI sendiri; main loop cukup panggil
  set_packs() / set_error().
"""

import colorsys
import logging
import math
import os
import queue
import random
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

log = logging.getLogger("tft")


def _env_int(name: str, default: int) -> int:
    return int(os.environ.get(name, str(default)))


def _env_float(name: str, default: float) -> float:
    return float(os.environ.get(name, str(default)))


def _env_bool(name: str, default: bool) -> bool:
    return os.environ.get(name, "1" if default else "0") == "1"


# ------------------------------------------------------------------ config

TFT_ENABLED = _env_bool("TFT_ENABLED", True)
TFT_SPI_PORT = _env_int("TFT_SPI_PORT", 0)
TFT_SPI_DEVICE = _env_int("TFT_SPI_DEVICE", 0)
TFT_SPI_HZ = _env_int("TFT_SPI_HZ", 16_000_000)
TFT_GPIO_DC = _env_int("TFT_GPIO_DC", 2)
TFT_GPIO_RST = _env_int("TFT_GPIO_RST", 3)
# luma ili9341 hanya mendukung buffer 320x240; orientasi diatur lewat rotate:
#   0 / 2 = landscape 320x240, 1 / 3 = portrait 240x320
TFT_ROTATE = _env_int("TFT_ROTATE", 3)
FONT_PATH = os.environ.get(
    "TFT_FONT_PATH", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
)

PAGE_INTERVAL = _env_float("TFT_PAGE_INTERVAL", 10)  # auto pindah halaman (detik)
MANUAL_HOLD = _env_float("TFT_MANUAL_HOLD", 30)  # jeda auto setelah geser manual
IDLE_TIMEOUT = _env_float("TFT_IDLE_TIMEOUT", 60)  # masuk screensaver
SAVER_MODE = os.environ.get("TFT_SAVER", "both")  # eyes | dance | both | off
SAVER_SWITCH = _env_float("TFT_SAVER_SWITCH", 30)  # ganti animasi (mode both)
SAVER_FPS = _env_float("TFT_SAVER_FPS", 10)
SLIDE_FRAMES = _env_int("TFT_SLIDE_FRAMES", 4)  # 0 = tanpa animasi geser

TOUCH_ENABLED = _env_bool("TOUCH_ENABLED", True)
TOUCH_SPI_PORT = _env_int("TOUCH_SPI_PORT", 0)
TOUCH_SPI_DEVICE = _env_int("TOUCH_SPI_DEVICE", 1)  # T_CS -> CE1 (GPIO7)
TOUCH_SPI_HZ = _env_int("TOUCH_SPI_HZ", 1_000_000)
TOUCH_Z_THRESHOLD = _env_int("TOUCH_Z_THRESHOLD", 400)
TOUCH_CAL = [int(v) for v in os.environ.get("TOUCH_CAL", "200,3900,200,3900").split(",")]
TOUCH_SWAP_XY = _env_bool("TOUCH_SWAP_XY", False)
TOUCH_INVERT_X = _env_bool("TOUCH_INVERT_X", False)
TOUCH_INVERT_Y = _env_bool("TOUCH_INVERT_Y", False)
TOUCH_SWIPE_MIN = _env_int("TOUCH_SWIPE_MIN", 40)  # px minimal dianggap geser
TOUCH_DEBUG = _env_bool("TOUCH_DEBUG", False)

try:
    from luma.core.interface.serial import spi
    from luma.lcd.device import ili9341
    LUMA_AVAILABLE = True
except ImportError:
    LUMA_AVAILABLE = False

try:
    from PIL import Image, ImageDraw, ImageFont
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

# ------------------------------------------------------------------ palette

C_BG = (15, 20, 28)
C_HEADER = (26, 34, 46)
C_CARD = (23, 30, 41)
C_BORDER = (42, 54, 74)
C_LABEL = (140, 155, 175)
C_TEXT = (255, 255, 255)
C_MUTED = (180, 190, 200)
C_SOC = (0, 210, 255)
C_POWER = (255, 193, 7)
C_TEMP = (255, 133, 27)
C_DELTA = (255, 99, 132)
C_MIN = (75, 192, 192)
C_MAX = (153, 102, 255)
C_RED = (217, 83, 79)
C_GREEN = (92, 184, 92)
C_GRAY = (119, 119, 119)
C_BLACK = (0, 0, 0)

DOTS_H = 12  # ruang bawah untuk indikator halaman


def status_of(current: float) -> Tuple[str, Tuple[int, int, int]]:
    if current > 0.1:
        return "DISCHARGE", C_RED
    if current < -0.1:
        return "CHARGE", C_GREEN
    return "IDLE", C_GRAY


def hue(h: float, s: float = 0.85, v: float = 1.0) -> Tuple[int, int, int]:
    r, g, b = colorsys.hsv_to_rgb(h % 1.0, s, v)
    return int(r * 255), int(g * 255), int(b * 255)


# ------------------------------------------------------------------ renderer


class Renderer:
    """Menggambar halaman ke PIL Image dan mengirimnya ke layar."""

    MARGIN = 6
    HEADER_H = 34

    def __init__(self, device=None):
        self.device = device
        self._fonts: Dict[int, Any] = {}
        self.last_img = None

        if self.device is not None:
            return
        if not (LUMA_AVAILABLE and PIL_AVAILABLE):
            log.warning("[TFT] Library 'luma.lcd' atau 'Pillow' belum terinstall.")
            return
        try:
            serial_interface = spi(
                port=TFT_SPI_PORT,
                device=TFT_SPI_DEVICE,
                gpio_DC=TFT_GPIO_DC,
                gpio_RST=TFT_GPIO_RST,
                bus_speed_hz=TFT_SPI_HZ,
            )
            self.device = ili9341(serial_interface, width=320, height=240, rotate=TFT_ROTATE)
            log.info(
                "[TFT] ILI9341 siap: %dx%d (rotate=%d)",
                self.device.width, self.device.height, TFT_ROTATE,
            )
        except Exception as exc:
            log.warning("[TFT] Gagal membuka layar TFT: %s", exc)
            self.device = None

    @property
    def W(self) -> int:
        return self.device.width

    @property
    def H(self) -> int:
        return self.device.height

    def display(self, img):
        self.device.display(img)
        self.last_img = img

    # ---------------------------------------------------------- helpers

    def font(self, size: int):
        if size not in self._fonts:
            try:
                self._fonts[size] = ImageFont.truetype(FONT_PATH, size)
            except Exception:
                self._fonts[size] = ImageFont.load_default()
        return self._fonts[size]

    @staticmethod
    def text(draw, xy, txt, font, fill, anchor="la"):
        try:
            draw.text(xy, txt, font=font, fill=fill, anchor=anchor)
        except (ValueError, TypeError):  # font bitmap default tidak mendukung anchor
            draw.text(xy, txt, font=font, fill=fill)

    def fit_font(self, draw, txt: str, max_w: float, sizes=(20, 18, 16, 14, 12)):
        for s in sizes:
            f = self.font(s)
            try:
                if draw.textlength(txt, font=f) <= max_w:
                    return f
            except Exception:
                return f
        return self.font(sizes[-1])

    def new_canvas(self, bg=C_BG):
        img = Image.new("RGB", (self.W, self.H), bg)
        return img, ImageDraw.Draw(img)

    def header(self, draw, title: str, badge: str, badge_bg):
        W, m, hh = self.W, self.MARGIN, self.HEADER_H
        draw.rectangle((0, 0, W - 1, hh), fill=C_HEADER)
        self.text(draw, (m + 2, hh // 2), title, self.font(16), C_TEXT, "lm")
        f = self.font(11)
        bw = int(draw.textlength(badge, font=f)) + 16
        bx1, by0 = W - m, (hh - 20) // 2
        draw.rectangle((bx1 - bw, by0, bx1, by0 + 20), fill=badge_bg)
        self.text(draw, (bx1 - bw // 2, by0 + 10), badge, f, C_TEXT, "mm")

    def card(self, draw, box, label, value, color):
        x0, y0, x1, y1 = box
        draw.rectangle(box, fill=C_CARD, outline=C_BORDER)
        self.text(draw, (x0 + 8, y0 + 6), label, self.font(11), C_LABEL)
        f = self.fit_font(draw, value, (x1 - x0) - 16)
        self.text(draw, (x0 + 8, y0 + 24), value, f, color)

    def dots(self, draw, idx: int, n: int):
        if n <= 1:
            return
        gap, r = 12, 3
        x = self.W // 2 - (n - 1) * gap // 2
        y = self.H - DOTS_H // 2
        for i in range(n):
            c = C_SOC if i == idx else C_BORDER
            draw.ellipse((x - r, y - r, x + r, y + r), fill=c)
            x += gap

    @staticmethod
    def cell_stats(pack):
        cells = pack.get("cells", [])
        v = [c["voltage"] for c in cells]
        if not v:
            return cells, v, 0.0, 0.0, 0.0, 0.0
        return cells, v, sum(v), min(v), max(v), (max(v) - min(v)) * 1000

    # ---------------------------------------------------------- pages

    def render_summary(self, pack):
        img, draw = self.new_canvas()
        W, H, m = self.W, self.H, self.MARGIN
        portrait = H > W
        bottom = H - DOTS_H

        soc = pack.get("soc")
        curr = pack.get("current") or 0.0
        pwr = pack.get("power") or 0.0
        temp = pack.get("temperature")
        cells, volts, v_tot, v_min, v_max, delta_mv = self.cell_stats(pack)
        status_str, status_bg = status_of(curr)

        self.header(draw, f"PACK #{pack.get('index', 1)}", status_str, status_bg)

        # SOC bar
        y = self.HEADER_H + m
        bar_h = 14
        f_soc = self.font(13)
        lbl_w = int(draw.textlength("SOC 100%", font=f_soc)) + 6
        bar_x1 = W - m - lbl_w
        draw.rectangle((m, y, bar_x1, y + bar_h), fill=C_CARD, outline=C_BORDER)
        if soc is not None:
            fill_w = int((bar_x1 - m - 2) * max(0, min(100, soc)) / 100)
            if fill_w > 0:
                draw.rectangle((m + 1, y + 1, m + 1 + fill_w, y + bar_h - 1), fill=C_SOC)
        soc_txt = f"{soc}%" if soc is not None else "--%"
        self.text(draw, (W - m, y + bar_h // 2), f"SOC {soc_txt}", f_soc, C_SOC, "rm")
        y += bar_h + m

        # Cards 2x2
        footer_h = 44
        chart_h = 66 if portrait else 0
        reserved = footer_h + m + (chart_h + m if chart_h else 0)
        ch = min(72, (bottom - y - reserved - m) // 2)
        cw = (W - 3 * m) // 2
        xa, xb = m, 2 * m + cw
        t_str = f"{temp:.1f} °C" if temp is not None else "N/A"
        self.card(draw, (xa, y, xa + cw, y + ch), "TOTAL VOLTAGE", f"{v_tot:.2f} V", C_TEXT)
        self.card(draw, (xb, y, xb + cw, y + ch), "CURRENT", f"{curr:+.2f} A", status_bg)
        y2 = y + ch + m
        self.card(draw, (xa, y2, xa + cw, y2 + ch), "POWER", f"{pwr:.1f} W", C_POWER)
        self.card(draw, (xb, y2, xb + cw, y2 + ch), "TEMPERATURE", t_str, C_TEMP)
        y = y2 + ch + m

        # Ringkasan cell
        draw.rectangle((m, y, W - m, y + footer_h), fill=C_CARD, outline=C_BORDER)
        if volts:
            fc = self.font(12)
            self.text(draw, (xa + 8, y + 6), f"Cells: {len(cells)}S", fc, C_MUTED)
            self.text(draw, (xb + 8, y + 6), f"Δ {delta_mv:.0f} mV", fc, C_DELTA)
            self.text(draw, (xa + 8, y + 24), f"Min {v_min:.3f} V", fc, C_MIN)
            self.text(draw, (xb + 8, y + 24), f"Max {v_max:.3f} V", fc, C_MAX)
        y += footer_h + m

        if chart_h and volts:
            self.cell_chart(draw, (m, y, W - m, min(bottom, y + chart_h)), volts, v_min, v_max)
        return img

    def cell_chart(self, draw, box, voltages, v_min, v_max):
        x0, y0, x1, y1 = box
        draw.rectangle(box, fill=C_CARD, outline=C_BORDER)
        n = len(voltages)
        inner_w, inner_h = (x1 - x0) - 8, (y1 - y0) - 10
        slot = inner_w / n
        gap = 1 if slot >= 4 else 0
        lo = v_min - 0.005
        span = max(v_max - lo, 0.020)  # min 20 mV agar batang tidak "loncat"
        for i, v in enumerate(voltages):
            h = max(2, int(inner_h * (v - lo) / span))
            bx0 = int(x0 + 4 + i * slot)
            bx1 = int(x0 + 4 + (i + 1) * slot) - gap - 1
            color = C_MAX if v == v_max else C_MIN if v == v_min else C_SOC
            draw.rectangle((bx0, y1 - 5 - h, max(bx0, bx1), y1 - 5), fill=color)

    def render_cells(self, pack):
        img, draw = self.new_canvas()
        W, H, m = self.W, self.H, self.MARGIN
        portrait = H > W
        bottom = H - DOTS_H
        cells, volts, _, v_min, v_max, delta_mv = self.cell_stats(pack)

        self.header(
            draw,
            f"PACK #{pack.get('index', 1)}",
            f"{len(cells)}S  Δ {delta_mv:.0f} mV",
            C_BORDER,
        )
        if not cells:
            self.text(draw, (W // 2, H // 2), "Belum ada data cell", self.font(14), C_MUTED, "mm")
            return img

        gap = 4
        y0 = self.HEADER_H + m
        avail_h = bottom - y0
        max_rows = max(1, (avail_h + gap) // (24 + gap))
        base_cols = 3 if portrait else 4
        cols = max(base_cols, math.ceil(len(cells) / max_rows))
        rows = math.ceil(len(cells) / cols)
        bw = (W - 2 * m - (cols - 1) * gap) / cols
        bh = min(40, (avail_h - (rows - 1) * gap) / rows)

        lo = v_min - 0.005
        span = max(v_max - lo, 0.020)
        f_lbl = self.font(10)
        for i, c in enumerate(cells):
            v = c["voltage"]
            x = m + (i % cols) * (bw + gap)
            y = y0 + (i // cols) * (bh + gap)
            box = (int(x), int(y), int(x + bw), int(y + bh))
            if v == v_max:
                color, outline = C_MAX, C_MAX
            elif v == v_min:
                color, outline = C_MIN, C_MIN
            else:
                color, outline = C_TEXT, C_BORDER
            draw.rectangle(box, fill=C_CARD, outline=outline)
            # bar level di dasar kotak
            lvl = max(0.05, min(1.0, (v - lo) / span))
            draw.rectangle(
                (box[0] + 2, box[3] - 4, box[0] + 2 + int((bw - 4) * lvl), box[3] - 2),
                fill=C_SOC if outline == C_BORDER else outline,
            )
            self.text(draw, (box[0] + 4, box[1] + 3), f"C{c['index']}", f_lbl, C_LABEL)
            val = f"{v:.3f}"
            f_val = self.fit_font(draw, val, bw - 30, sizes=(15, 14, 13, 12, 11, 10))
            self.text(draw, (box[2] - 4, (box[1] + box[3]) // 2 - 1), val, f_val, color, "rm")
        return img

    def render_error(self, message: str):
        img, draw = self.new_canvas()
        W, H = self.W, self.H
        draw.rectangle((0, 0, W - 1, self.HEADER_H), fill=C_RED)
        self.text(draw, (W // 2, self.HEADER_H // 2), "BMS OFFLINE", self.font(16), C_TEXT, "mm")
        self.text(draw, (W // 2, H // 2 - 14), "Status koneksi serial:", self.font(12), C_MUTED, "mm")
        f = self.fit_font(draw, message, W - 16, sizes=(18, 16, 14, 12))
        self.text(draw, (W // 2, H // 2 + 12), message, f, C_DELTA, "mm")
        return img


# ------------------------------------------------------------------ screensavers


class EyesSaver:
    """Mata robot (gaya Cozmo): melirik, berkedip, sesekali tersenyum."""

    COLOR = (0, 210, 255)

    def __init__(self, r: Renderer):
        self.r = r
        now = time.monotonic()
        self.look = [0.0, 0.0]
        self.target = [0.0, 0.0]
        self.next_look = now + 1.0
        self.blink_start: Optional[float] = None
        self.next_blink = now + 2.0
        self.happy_until = 0.0
        self.next_happy = now + random.uniform(8, 15)

    def frame(self, now: float, info: Dict[str, Any]):
        r = self.r
        img, draw = r.new_canvas(C_BLACK)
        W, H = r.W, r.H

        # arah lirikan
        if now >= self.next_look:
            if random.random() < 0.35:
                self.target = [0.0, 0.0]
            else:
                self.target = [random.uniform(-1, 1), random.uniform(-0.8, 0.8)]
            self.next_look = now + random.uniform(1.2, 3.0)
        for i in (0, 1):
            self.look[i] += (self.target[i] - self.look[i]) * 0.45

        # kedip
        open_f = 1.0
        if self.blink_start is not None:
            p = (now - self.blink_start) / 0.24
            if p >= 1:
                self.blink_start = None
                # 20% kemungkinan kedip dua kali
                self.next_blink = now + (0.15 if random.random() < 0.2 else random.uniform(2.5, 6))
            else:
                open_f = max(0.06, abs(1 - 2 * p))
        elif now >= self.next_blink:
            self.blink_start = now

        # senyum
        if now >= self.next_happy:
            self.happy_until = now + 2.5
            self.next_happy = now + random.uniform(10, 20)
        happy = now < self.happy_until

        s = min(W, H)
        ew, eh, gap = s * 0.30, s * 0.38, s * 0.12
        cx = W / 2 + self.look[0] * W * 0.10
        cy = H * 0.44 + self.look[1] * H * 0.07
        for side in (-1, 1):
            scale = 1 + 0.12 * self.look[0] * side  # mata di arah lirikan sedikit lebih besar
            w, h = ew * scale, max(4.0, eh * scale * open_f)
            ex = cx + side * (gap / 2 + ew / 2)
            box = (ex - w / 2, cy - h / 2, ex + w / 2, cy + h / 2)
            draw.rounded_rectangle(box, radius=max(1, int(min(w, h) * 0.3)), fill=self.COLOR)
            if happy and open_f > 0.5:
                # potong bagian bawah -> bentuk ^ ^
                draw.ellipse((ex - w * 0.75, cy + h * 0.05, ex + w * 0.75, cy + h * 1.25), fill=C_BLACK)

        draw_saver_status(r, draw, info)
        return img


class DanceSaver:
    """Stick figure joget di lantai disko, ganti gerakan tiap 8 ketukan."""

    BPM = 118

    def __init__(self, r: Renderer):
        self.r = r
        self.notes: List[Dict[str, float]] = []
        self.next_note = 0.0

    @staticmethod
    def _limb(origin, a_deg, length, side):
        """a_deg: 0 = lurus ke bawah, 180 = lurus ke atas; side -1 kiri / +1 kanan."""
        a = math.radians(a_deg)
        return origin[0] + side * length * math.sin(a), origin[1] + length * math.cos(a)

    @staticmethod
    def _knee(hip, foot, L, side):
        """IK dua tulang: lutut ditekuk keluar (side)."""
        dx, dy = foot[0] - hip[0], foot[1] - hip[1]
        d = max(1e-3, min(math.hypot(dx, dy), 2 * L - 0.01))
        mx, my = (hip[0] + foot[0]) / 2, (hip[1] + foot[1]) / 2
        h = math.sqrt(max(0.0, L * L - (d / 2) ** 2))
        nx, ny = -dy / d, dx / d
        if nx * side < 0:
            nx, ny = -nx, -ny
        return mx + nx * h, my + ny * h

    def frame(self, now: float, info: Dict[str, Any]):
        r = self.r
        img, draw = r.new_canvas(C_BLACK)
        W, H = r.W, r.H
        s = min(W, H) / 240
        beat = now * self.BPM / 60
        ph = beat * 2 * math.pi
        move = int(beat // 8) % 4
        floor_y = H * 0.80

        # lampu sorot
        draw.polygon(
            [(W / 2 - 18 * s, 0), (W / 2 + 18 * s, 0), (W / 2 + 90 * s, floor_y), (W / 2 - 90 * s, floor_y)],
            fill=(22, 22, 40),
        )

        # lantai disko (kedip per ketukan)
        tiles = 8
        tw = W / tiles
        b = int(beat)
        for row in range(2):
            for i in range(tiles):
                lit = (i + row + b) % 3 == 0
                c = hue((i * 0.12 + row * 0.3 + b * 0.07), 0.8, 0.9 if lit else 0.25)
                y0 = floor_y + 4 + row * 14 * s
                draw.rectangle((i * tw + 1, y0, (i + 1) * tw - 2, y0 + 12 * s), fill=c)

        # badan
        L_leg = 32 * s
        bounce = abs(math.sin(ph))
        hip = (W / 2 + 12 * s * math.sin(ph / 2), floor_y - (2 * L_leg - 10 * s) - 6 * s * (1 - bounce))
        lean = 8 * s * math.sin(ph / 2)
        neck = (hip[0] + lean, hip[1] - 56 * s)
        shoulder = (neck[0], neck[1] + 6 * s)
        head = (neck[0] + lean * 0.4, neck[1] - 18 * s + 2 * s * math.sin(ph * 2))

        # kaki
        lift_l = 12 * s * max(0.0, math.sin(ph)) if move in (1, 3) else 0.0
        lift_r = 12 * s * max(0.0, -math.sin(ph)) if move in (1, 3) else 0.0
        foot_l = (W / 2 - 24 * s, floor_y - lift_l)
        foot_r = (W / 2 + 24 * s, floor_y - lift_r)
        knee_l = self._knee(hip, foot_l, L_leg, -1)
        knee_r = self._knee(hip, foot_r, L_leg, +1)

        # tangan: (sudut bahu, tekukan siku) per gerakan
        sw = math.sin(ph)
        if move == 0:  # tangan di atas, goyang
            arms = {-1: (150 + 20 * sw, 30), 1: (150 - 20 * sw, 30)}
        elif move == 1:  # ayun samping
            arms = {-1: (60 + 40 * sw, 70), 1: (60 - 40 * sw, 70)}
        elif move == 2:  # disco point, ganti tiap ketukan
            up, hip_ = (165, 0), (40, 110)
            arms = {-1: up, 1: hip_} if b % 2 == 0 else {-1: hip_, 1: up}
        else:  # melambai di atas kepala
            arms = {side: (150 + 25 * math.sin(ph + side * math.pi / 2), 25) for side in (-1, 1)}

        color = hue(now * 0.08)
        lw = max(3, int(5 * s))

        def seg(p, q):
            draw.line([p, q], fill=color, width=lw)
            rr = lw / 2
            draw.ellipse((q[0] - rr, q[1] - rr, q[0] + rr, q[1] + rr), fill=color)

        seg(hip, knee_l), seg(knee_l, foot_l)
        seg(hip, knee_r), seg(knee_r, foot_r)
        seg(hip, neck)
        for side, (a, bend) in arms.items():
            elbow = self._limb(shoulder, a, 26 * s, side)
            hand = self._limb(elbow, a + bend, 24 * s, side)
            seg(shoulder, elbow), seg(elbow, hand)

        hr = 14 * s
        draw.ellipse((head[0] - hr, head[1] - hr, head[0] + hr, head[1] + hr), fill=color)
        er = max(1.5, 2 * s)
        for ex in (-5 * s, 5 * s):
            draw.ellipse((head[0] + ex - er, head[1] - 3 * s - er, head[0] + ex + er, head[1] - 3 * s + er), fill=C_BLACK)
        draw.arc((head[0] - 6 * s, head[1] - 2 * s, head[0] + 6 * s, head[1] + 7 * s), 20, 160, fill=C_BLACK, width=max(1, int(2 * s)))

        # not balok melayang
        if now >= self.next_note:
            self.notes.append({"x": hip[0] + random.uniform(-80, 80) * s, "t0": now, "h": random.random(),
                               "g": random.choice("♪♫")})
            self.next_note = now + random.uniform(0.4, 0.8)
        f_note = r.font(int(22 * s))
        alive = []
        for n in self.notes:
            age = now - n["t0"]
            if age > 2.5:
                continue
            alive.append(n)
            x = n["x"] + 8 * s * math.sin(age * 4)
            y = floor_y - 40 * s - age * 40 * s
            r.text(draw, (x, y), n["g"], f_note, hue(n["h"], 0.7, max(0.2, 1 - age / 2.5)), "mm")
        self.notes = alive

        draw_saver_status(r, draw, info)
        return img


def draw_saver_status(r: Renderer, draw, info: Dict[str, Any]):
    W, H = r.W, r.H
    f = r.font(12)
    if info.get("error"):
        r.text(draw, (W // 2, H - 22), "BMS OFFLINE", f, C_RED, "mm")
    elif info.get("soc") is not None:
        r.text(draw, (W // 2, H - 22), f"SOC {info['soc']}%  ·  {info['status']}", f, C_MUTED, "mm")
    r.text(draw, (W // 2, H - 8), "sentuh layar untuk kembali", r.font(10), C_GRAY, "mm")


# ------------------------------------------------------------------ touch


class XPT2046:
    """Driver minimal XPT2046 lewat spidev (polling tekanan, IRQ tidak wajib)."""

    def __init__(self, width: int, height: int):
        import spidev  # ikut terinstall bersama luma.core

        self.W, self.H = width, height
        self.spi = spidev.SpiDev()
        self.spi.open(TOUCH_SPI_PORT, TOUCH_SPI_DEVICE)
        self.spi.max_speed_hz = TOUCH_SPI_HZ
        self.spi.mode = 0

    def _read(self, cmd: int) -> int:
        r = self.spi.xfer2([cmd, 0, 0])
        return ((r[1] << 8) | r[2]) >> 3

    def read(self) -> Optional[Tuple[int, int, int, int]]:
        """Return (x, y, raw_x, raw_y) di koordinat layar, atau None jika tidak disentuh."""
        z1 = self._read(0xB1)
        z2 = self._read(0xC1)
        z = z1 + 4095 - z2
        if z < TOUCH_Z_THRESHOLD:
            self._read(0xD0)  # power down
            return None
        xs = sorted(self._read(0xD1) for _ in range(5))
        ys = sorted(self._read(0x91) for _ in range(5))
        self._read(0xD0)
        rx, ry = xs[2], ys[2]  # median
        x, y = self._map(rx, ry)
        return x, y, rx, ry

    def _map(self, rx: int, ry: int) -> Tuple[int, int]:
        xmin, xmax, ymin, ymax = TOUCH_CAL
        nx = min(1.0, max(0.0, (rx - xmin) / float(xmax - xmin)))
        ny = min(1.0, max(0.0, (ry - ymin) / float(ymax - ymin)))
        if TOUCH_SWAP_XY:
            nx, ny = ny, nx
        if TOUCH_INVERT_X:
            nx = 1 - nx
        if TOUCH_INVERT_Y:
            ny = 1 - ny
        return int(nx * (self.W - 1)), int(ny * (self.H - 1))

    def close(self):
        try:
            self.spi.close()
        except Exception:
            pass


class TouchThread(threading.Thread):
    """Polling touch -> event ('down', pt) / ('tap', pt) / ('swipe', +1|-1) ke queue."""

    def __init__(self, touch: XPT2046, events: "queue.Queue"):
        super().__init__(daemon=True, name="tft-touch")
        self.touch = touch
        self.events = events
        self.stop_evt = threading.Event()

    def run(self):
        down = False
        start = last = (0, 0)
        miss = 0
        while not self.stop_evt.is_set():
            try:
                res = self.touch.read()
            except Exception as exc:
                log.warning("[TOUCH] read error: %s", exc)
                self.stop_evt.wait(1.0)
                continue

            if res:
                pt = (res[0], res[1])
                if not down:
                    down, start, miss = True, pt, 0
                    self.events.put(("down", pt))
                    if TOUCH_DEBUG:
                        log.info("[TOUCH] down raw=(%d,%d) -> layar=(%d,%d)", res[2], res[3], *pt)
                last, miss = pt, 0
            elif down:
                miss += 1
                if miss >= 3:  # debounce lepas jari (~60 ms)
                    down = False
                    dx, dy = last[0] - start[0], last[1] - start[1]
                    if abs(dx) >= TOUCH_SWIPE_MIN and abs(dx) > abs(dy) * 1.2:
                        # geser ke kiri (dx<0) = halaman berikutnya, seperti di HP
                        self.events.put(("swipe", 1 if dx < 0 else -1))
                        gesture = "swipe-left" if dx < 0 else "swipe-right"
                    else:
                        self.events.put(("tap", start))
                        gesture = "tap"
                    if TOUCH_DEBUG:
                        log.info("[TOUCH] up dx=%d dy=%d -> %s", dx, dy, gesture)
            self.stop_evt.wait(0.02)

    def stop(self):
        self.stop_evt.set()


# ------------------------------------------------------------------ UI thread


class TFTUI(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True, name="tft-ui")
        self.r = Renderer()
        self.events: "queue.Queue" = queue.Queue()
        self._lock = threading.Lock()
        self._packs: List[Dict[str, Any]] = []
        self._error: Optional[str] = None
        self._version = 0
        self._stop_evt = threading.Event()
        self.touch: Optional[XPT2046] = None
        self.touch_thread: Optional[TouchThread] = None

        if not self.ok:
            return
        if TOUCH_ENABLED:
            try:
                self.touch = XPT2046(self.r.W, self.r.H)
                self.touch_thread = TouchThread(self.touch, self.events)
                log.info("[TOUCH] XPT2046 aktif di spidev%d.%d", TOUCH_SPI_PORT, TOUCH_SPI_DEVICE)
            except Exception as exc:
                log.warning("[TOUCH] Gagal membuka touch XPT2046: %s", exc)

        # tanpa touch, screensaver tidak bisa dibangunkan -> matikan
        self.saver_kinds = {"eyes": ["eyes"], "dance": ["dance"], "both": ["eyes", "dance"]}.get(SAVER_MODE, [])
        if self.saver_kinds and self.touch is None:
            log.warning("[TFT] Touch tidak aktif; screensaver dinonaktifkan")
            self.saver_kinds = []

    @property
    def ok(self) -> bool:
        return self.r.device is not None

    # ---------------------------------------------------------- API untuk main loop

    def set_packs(self, packs: List[Dict[str, Any]]):
        with self._lock:
            self._packs = list(packs)
            self._error = None
            self._version += 1

    def set_error(self, message: str):
        with self._lock:
            self._error = message
            self._packs = []
            self._version += 1

    def start(self):
        if self.touch_thread:
            self.touch_thread.start()
        super().start()

    def stop(self):
        self._stop_evt.set()
        if self.touch_thread:
            self.touch_thread.stop()
            self.touch_thread.join(timeout=1)
        if self.is_alive():
            self.join(timeout=2)
        if self.touch:
            self.touch.close()

    # ---------------------------------------------------------- internals

    def _pages(self) -> List[Tuple[str, Any]]:
        with self._lock:
            packs, err = list(self._packs), self._error
        if not packs:
            return [("error", err or "Menunggu data BMS...")]
        pages: List[Tuple[str, Any]] = []
        for p in packs:
            pages += [("summary", p), ("cells", p)]
        return pages

    def _render_page(self, pages, idx: int):
        kind, data = pages[idx]
        if kind == "summary":
            img = self.r.render_summary(data)
        elif kind == "cells":
            img = self.r.render_cells(data)
        else:
            img = self.r.render_error(data)
        self.r.dots(ImageDraw.Draw(img), idx, len(pages))
        return img

    def _slide_to(self, new_img, direction: int):
        old = self.r.last_img
        if old is None or SLIDE_FRAMES <= 0:
            self.r.display(new_img)
            return
        W, H = self.r.W, self.r.H
        for k in range(1, SLIDE_FRAMES):
            p = 1 - (1 - k / SLIDE_FRAMES) ** 3  # ease-out cubic
            off = int(W * p)
            frame = Image.new("RGB", (W, H), C_BG)
            frame.paste(old, (-direction * off, 0))
            frame.paste(new_img, (direction * (W - off), 0))
            self.r.display(frame)
        self.r.display(new_img)

    def _saver_info(self) -> Dict[str, Any]:
        with self._lock:
            packs, err = list(self._packs), self._error
        if not packs:
            return {"error": err or True}
        p = packs[0]
        return {"soc": p.get("soc"), "status": status_of(p.get("current") or 0.0)[0]}

    def _make_saver(self, kind: str):
        return EyesSaver(self.r) if kind == "eyes" else DanceSaver(self.r)

    def run(self):
        mode = "pages"
        page_idx = 0
        now = time.monotonic()
        last_touch = now
        next_auto = now + PAGE_INTERVAL
        seen_version = -1
        swallow = False  # abaikan sisa gesture yang dipakai untuk membangunkan layar
        saver = None
        saver_i = 0
        saver_start = 0.0
        frame_dt = 1.0 / max(1.0, SAVER_FPS)

        while not self._stop_evt.is_set():
            try:
                now = time.monotonic()

                # --- event touch
                while True:
                    try:
                        kind, val = self.events.get_nowait()
                    except queue.Empty:
                        break
                    last_touch = now
                    if kind == "down":
                        if mode == "saver":
                            mode, page_idx, swallow = "pages", 0, True
                            seen_version = -1  # paksa render summary
                            next_auto = now + PAGE_INTERVAL
                    elif swallow:
                        swallow = False
                    elif kind == "swipe" and mode == "pages":
                        pages = self._pages()
                        if len(pages) > 1:
                            page_idx = (page_idx + val) % len(pages)
                            self._slide_to(self._render_page(pages, page_idx), val)
                            seen_version = self._version
                            next_auto = time.monotonic() + MANUAL_HOLD

                # --- mode halaman
                if mode == "pages":
                    if self.saver_kinds and now - last_touch >= IDLE_TIMEOUT:
                        mode, saver_start = "saver", now
                        saver = self._make_saver(self.saver_kinds[saver_i % len(self.saver_kinds)])
                        continue

                    pages = self._pages()
                    page_idx %= len(pages)
                    if now >= next_auto:
                        next_auto = now + PAGE_INTERVAL
                        if len(pages) > 1:
                            page_idx = (page_idx + 1) % len(pages)
                            self._slide_to(self._render_page(pages, page_idx), 1)
                            seen_version = self._version
                            continue
                    if self._version != seen_version:
                        seen_version = self._version
                        self.r.display(self._render_page(pages, page_idx))
                    self._stop_evt.wait(0.03)

                # --- mode screensaver
                else:
                    if len(self.saver_kinds) > 1 and now - saver_start >= SAVER_SWITCH:
                        saver_i += 1
                        saver_start = now
                        saver = self._make_saver(self.saver_kinds[saver_i % len(self.saver_kinds)])
                    t0 = time.monotonic()
                    self.r.display(saver.frame(t0, self._saver_info()))
                    self._stop_evt.wait(max(0.0, frame_dt - (time.monotonic() - t0)))

            except Exception as exc:
                log.warning("[TFT] render gagal: %s", exc)
                self._stop_evt.wait(1.0)