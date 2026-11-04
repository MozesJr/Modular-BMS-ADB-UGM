#!/usr/bin/env python3
"""Device config portal: halaman web + watchdog WiFi + tombol + OLED, satu proses."""
import functools
import hashlib
import hmac
import json
import logging
import os
import secrets
import socket
import subprocess
import threading
import time

from flask import (Flask, abort, flash, jsonify, redirect, render_template,
                   request, session, url_for)
from werkzeug.security import check_password_hash, generate_password_hash

import config_store
import net
import settings as S
from display import Display

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s: %(message)s")
log = logging.getLogger("main")

net_lock = threading.RLock()      # satu operasi jaringan dalam satu waktu
display = Display()
state = {
    "mode": "boot", "ssid": "", "ip": "",
    "ap_since": 0.0,              # kapan hotspot terakhir dinyalakan
    "last_web": 0.0,              # kapan halaman web terakhir dipakai
    "last_error": "",             # hasil percobaan WiFi terakhir, tampil di web
    "override": None,             # baris OLED sementara (saat tombol ditahan, dll.)
}


# ---------------------------------------------------------------- aksi inti --

def refresh_status():
    st = net.status()
    state.update(st)
    try:
        tmp = S.STATUS_PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump({**st, "ap_ssid": S.AP_SSID, "device_id": S.DEVICE_ID}, f)
        os.replace(tmp, S.STATUS_PATH)
    except OSError:
        pass
    return st


def enter_ap():
    with net_lock:
        ok, out = net.start_ap()
        state["ap_since"] = time.monotonic()
        if not ok:
            log.error("Hotspot gagal naik: %s", out)
        refresh_status()


def restart_app():
    if S.APP_SERVICE and not S.MOCK:
        subprocess.run(["systemctl", "restart", S.APP_SERVICE], check=False)


def apply_wifi_async(ssid, psk, hidden):
    """Jalan di thread terpisah: respons HTTP harus terkirim dulu sebelum
    hotspot dimatikan untuk mencoba WiFi baru."""
    def job():
        time.sleep(2)
        with net_lock:
            state["override"] = ["Mencoba WiFi:", ssid, "", "Mohon tunggu..."]
            ok, err = net.apply_wifi(ssid, psk, hidden)
            if ok:
                state["last_error"] = ""
            else:
                log.warning("WiFi '%s' gagal: %s", ssid, err)
                state["last_error"] = f"Gagal konek ke '{ssid}'. Cek nama dan password WiFi."
                state["override"] = ["WiFi GAGAL:", ssid, "", "Kembali ke", "setelan lama..."]
                if not net.connect_saved():   # rollback ke WiFi lama, kalau ada
                    enter_ap()
                time.sleep(3)
            state["override"] = None
            refresh_status()
    threading.Thread(target=job, daemon=True).start()


def factory_reset():
    log.warning("FACTORY RESET")
    state["override"] = ["FACTORY RESET", "", "Menghapus setelan..."]
    time.sleep(1)
    config_store.reset()
    with net_lock:
        net.forget_all()
    if S.MOCK:
        state["override"] = None
        enter_ap()
        return
    subprocess.run(["sync"], check=False)
    subprocess.run(["systemctl", "reboot"], check=False)   # boot tanpa WiFi -> mode setup


# ------------------------------------------------------------ thread latar --

def watchdog_loop():
    if not net.wifi_profiles():
        enter_ap()                      # alat baru / habis reset
    offline_since = None
    while True:
        time.sleep(5)
        with net_lock:
            st = refresh_status()
            now = time.monotonic()
            if st["mode"] == "sta":
                offline_since = None
            elif st["mode"] == "ap":
                offline_since = None
                # Router mungkin cuma mati sebentar: sesekali coba lagi WiFi lama,
                # asal tidak ada yang sedang memakai halaman setup.
                if (net.wifi_profiles()
                        and now - state["ap_since"] > S.AP_RETRY_S
                        and now - state["last_web"] > S.AP_IDLE_S):
                    net.stop_ap()
                    if not net.connect_saved():
                        enter_ap()
                    refresh_status()
            else:
                offline_since = offline_since or now
                if now - offline_since > S.WIFI_GRACE_S:
                    offline_since = None
                    enter_ap()


def button_loop():
    try:
        from gpiozero import Button
        btn = Button(S.BUTTON_GPIO, pull_up=True, bounce_time=0.05)
    except Exception as e:
        log.warning("Tombol tidak aktif: %s", e)
        return
    while True:
        btn.wait_for_press()
        t0, held = time.monotonic(), 0.0
        while btn.is_pressed:
            held = time.monotonic() - t0
            if held >= S.HOLD_RESET_S:
                state["override"] = ["LEPAS SEKARANG:", "FACTORY RESET"]
            elif held >= S.HOLD_SETUP_S:
                left = int(S.HOLD_RESET_S - held) + 1
                state["override"] = ["Lepas: mode setup", "", f"Tahan {left} dtk lagi:", "factory reset"]
            else:
                state["override"] = [f"Tahan {S.HOLD_SETUP_S} dtk: setup",
                                     f"Tahan {S.HOLD_RESET_S} dtk: reset"]
            time.sleep(0.1)
        state["override"] = None
        if held >= S.HOLD_RESET_S:
            factory_reset()
        elif held >= S.HOLD_SETUP_S:
            enter_ap()


def display_loop():
    while True:
        if state["override"]:
            lines = state["override"]
        elif state["mode"] == "ap":
            lines = ["== MODE SETUP ==", f"WiFi: {S.AP_SSID}", f"Pass: {S.DEVICE_KEY}",
                     "Buka di browser:", S.AP_IP]
        elif state["mode"] == "sta":
            cfg = config_store.load()
            lines = [cfg["device_name"], f"WiFi: {state['ssid']}", state["ip"],
                     f"MQTT: {cfg['mqtt']['host'] or '-'}", f"ID: {S.DEVICE_ID}"]
        else:
            lines = ["Menghubungkan WiFi...", "", f"ID: {S.DEVICE_ID}"]
        display.show(lines)
        time.sleep(0.3)


# -------------------------------------------------------------------- web --

app = Flask(__name__)
app.secret_key = hashlib.sha256(("flask" + S.SECRET_SALT + S.SERIAL).encode()).digest()
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"


def password_ok(pw):
    h = config_store.load().get("admin_password_hash")
    if h:
        return check_password_hash(h, pw)
    return hmac.compare_digest(pw.encode(), S.DEVICE_KEY.encode())


def login_required(fn):
    @functools.wraps(fn)
    def wrapper(*a, **kw):
        if not session.get("auth"):
            return redirect(url_for("login"))
        return fn(*a, **kw)
    return wrapper


@app.before_request
def _before():
    state["last_web"] = time.monotonic()
    if "csrf" not in session:
        session["csrf"] = secrets.token_hex(16)
    if request.method == "POST":
        sent = request.form.get("csrf", "")
        if not hmac.compare_digest(sent, session["csrf"]):
            abort(400, "Sesi kedaluwarsa, muat ulang halaman.")


@app.context_processor
def _ctx():
    return {"csrf": session.get("csrf", ""), "S": S, "state": state}


@app.errorhandler(404)
def _captive(_e):
    # Di mode setup semua nama domain diarahkan ke alat (lihat install.sh), jadi
    # cek koneksi dari HP mendarat di sini dan memunculkan pop-up "Sign in".
    if state["mode"] == "ap":
        return redirect(f"http://{S.AP_IP}/", code=302)
    return redirect(url_for("index"))


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        if password_ok(request.form.get("password", "")):
            session["auth"] = True
            return redirect(url_for("index"))
        time.sleep(1.5)                 # perlambat tebak-tebakan
        flash("Password salah.", "err")
    return render_template("login.html")


@app.route("/logout", methods=["POST"])
def logout():
    session.pop("auth", None)
    return redirect(url_for("login"))


@app.route("/")
@login_required
def index():
    return render_template("index.html", cfg=config_store.load(),
                           nets=net.scan(rescan=False),
                           default_pw=not config_store.load().get("admin_password_hash"))


@app.route("/scan")
@login_required
def scan():
    # Di mode hotspot radio sedang dipakai, jadi hanya bisa kirim hasil scan terakhir.
    with net_lock:
        return jsonify(net.scan(rescan=state["mode"] != "ap"))


@app.route("/wifi", methods=["POST"])
@login_required
def wifi():
    ssid = request.form.get("ssid", "").strip()
    psk = request.form.get("psk", "")
    if not ssid or len(ssid.encode()) > 32:
        flash("Nama WiFi (SSID) wajib diisi, maksimal 32 karakter.", "err")
    elif psk and not 8 <= len(psk) <= 63:
        flash("Password WiFi harus 8-63 karakter (kosongkan untuk WiFi terbuka).", "err")
    else:
        apply_wifi_async(ssid, psk, bool(request.form.get("hidden")))
        return render_template("wait.html", ssid=ssid)
    return redirect(url_for("index"))


@app.route("/mqtt", methods=["POST"])
@login_required
def mqtt():
    f = request.form
    host = f.get("host", "").strip()
    try:
        port = int(f.get("port", ""))
        assert 1 <= port <= 65535
    except (ValueError, AssertionError):
        flash("Port MQTT harus angka 1-65535.", "err")
        return redirect(url_for("index"))
    if not host:
        flash("Host MQTT wajib diisi.", "err")
        return redirect(url_for("index"))

    # Tes dulu sebelum simpan, supaya salah ketik tidak bikin alat diam-diam putus.
    if state["mode"] == "sta" and not f.get("force"):
        try:
            socket.create_connection((host, port), timeout=6).close()
        except OSError as e:
            flash(f"Broker {host}:{port} tidak bisa dihubungi ({e}). Setelan TIDAK disimpan. "
                  "Centang 'Tetap simpan' kalau memang yakin.", "err")
            return redirect(url_for("index"))

    cfg = config_store.load()
    m = cfg["mqtt"]
    m.update(host=host, port=port, username=f.get("username", "").strip(),
             base_topic=f.get("base_topic", "").strip().strip("/"), tls=bool(f.get("tls")))
    if f.get("password"):               # kosong = pakai password lama
        m["password"] = f["password"]
    if f.get("clear_password"):
        m["password"] = ""
    config_store.save(cfg)
    restart_app()
    flash("Setelan MQTT disimpan." + ("" if state["mode"] == "sta"
          else " (Belum dites: alat sedang tidak terhubung internet.)"), "ok")
    return redirect(url_for("index"))


@app.route("/device", methods=["POST"])
@login_required
def device():
    name = request.form.get("device_name", "").strip()[:21]
    try:
        interval = int(request.form.get("interval_s", ""))
        assert 1 <= interval <= 86400
    except (ValueError, AssertionError):
        flash("Interval harus angka 1-86400 detik.", "err")
        return redirect(url_for("index"))
    cfg = config_store.load()
    cfg["device_name"] = name or cfg["device_name"]
    cfg["app"]["interval_s"] = interval
    config_store.save(cfg)
    restart_app()
    flash("Setelan perangkat disimpan.", "ok")
    return redirect(url_for("index"))


@app.route("/password", methods=["POST"])
@login_required
def password():
    new = request.form.get("new", "")
    if not password_ok(request.form.get("old", "")):
        flash("Password lama salah.", "err")
    elif len(new) < 8 or new != request.form.get("new2", ""):
        flash("Password baru minimal 8 karakter dan kedua isian harus sama.", "err")
    else:
        cfg = config_store.load()
        cfg["admin_password_hash"] = generate_password_hash(new, method="pbkdf2:sha256:60000")
        config_store.save(cfg)
        flash("Password login diganti.", "ok")
    return redirect(url_for("index"))


@app.route("/reset", methods=["POST"])
@login_required
def reset():
    if request.form.get("confirm", "").strip().upper() != "RESET":
        flash("Ketik RESET untuk konfirmasi.", "err")
        return redirect(url_for("index"))
    session.clear()
    threading.Thread(target=lambda: (time.sleep(2), factory_reset()), daemon=True).start()
    return render_template("wait.html", ssid=None)


def main():
    os.makedirs(S.DATA_DIR, exist_ok=True)
    if S.SECRET_SALT.startswith("GANTI"):
        log.warning("SECRET_SALT masih bawaan. Ganti di settings.py sebelum produksi!")
    log.info("Device %s | hotspot %s | password awal %s", S.DEVICE_ID, S.AP_SSID, S.DEVICE_KEY)
    for fn in (watchdog_loop, button_loop, display_loop):
        threading.Thread(target=fn, daemon=True, name=fn.__name__).start()
    app.run(host="0.0.0.0", port=S.WEB_PORT, threaded=True, use_reloader=False)


if __name__ == "__main__":
    main()
