"""Pembungkus nmcli (NetworkManager, bawaan Raspberry Pi OS Bookworm ke atas).

Pi Zero W hanya punya satu radio: hotspot dan koneksi WiFi tidak bisa jalan
bersamaan. Jadi scan dilakukan SEBELUM hotspot naik dan hasilnya di-cache.
"""
import logging
import re
import subprocess

import settings as S

log = logging.getLogger("net")
_scan_cache = []
_mock = {"mode": "ap", "ssid": S.AP_SSID, "ip": S.AP_IP, "profiles": []}


def _nm(*args, timeout=45):
    if S.MOCK:
        shown = ["***" if i and args[i - 1].endswith("psk") else a for i, a in enumerate(args)]
        log.info("[mock] nmcli %s", " ".join(shown))
        return True, ""
    try:
        p = subprocess.run(["nmcli", *args], capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return False, "timeout"
    out = p.stdout.strip() or p.stderr.strip()
    if p.returncode != 0:
        log.warning("nmcli %s gagal: %s", args[:4], out)
    return p.returncode == 0, out


def _split(line):
    """Pisah output `nmcli -t` (pemisah ':' dengan escape '\\:')."""
    return [p.replace("\\:", ":").replace("\\\\", "\\") for p in re.split(r"(?<!\\):", line)]


def wifi_profiles():
    """Nama semua profil WiFi tersimpan selain hotspot."""
    if S.MOCK:
        return list(_mock["profiles"])
    ok, out = _nm("-t", "-f", "NAME,TYPE", "con", "show")
    names = []
    for line in out.splitlines() if ok else []:
        parts = _split(line)
        if len(parts) >= 2 and parts[1] == "802-11-wireless" and parts[0] != S.AP_CON:
            names.append(parts[0])
    return names


def status():
    """-> {"mode": "sta" | "ap" | "offline", "ssid": str, "ip": str}"""
    if S.MOCK:
        return {k: _mock[k] for k in ("mode", "ssid", "ip")}
    res = {"mode": "offline", "ssid": "", "ip": ""}
    ok, out = _nm("-t", "-f", "DEVICE,STATE,CONNECTION", "dev", "status")
    for line in out.splitlines() if ok else []:
        parts = _split(line) + ["", ""]
        if parts[0] != S.WIFI_IFACE or parts[1] != "connected":
            continue
        con = parts[2]
        if con == S.AP_CON:
            return {"mode": "ap", "ssid": S.AP_SSID, "ip": S.AP_IP}
        res["mode"] = "sta"
        ok, ssid = _nm("-g", "802-11-wireless.ssid", "con", "show", con)
        res["ssid"] = ssid if ok and ssid else con
        ok, ip = _nm("-g", "IP4.ADDRESS", "dev", "show", S.WIFI_IFACE)
        if ok and ip:
            res["ip"] = ip.split("|")[0].strip().split("/")[0]
    return res


def scan(rescan=True):
    """Daftar jaringan terlihat, terkuat dulu. Di mode hotspot pakai rescan=False."""
    global _scan_cache
    if S.MOCK:
        _scan_cache = [{"ssid": "Kantor-2G", "signal": 78, "secure": True},
                       {"ssid": "Warung Kopi", "signal": 41, "secure": False}]
        return _scan_cache
    if not rescan:
        return _scan_cache
    ok, out = _nm("-t", "-f", "SSID,SIGNAL,SECURITY", "dev", "wifi", "list",
                  "ifname", S.WIFI_IFACE, "--rescan", "yes", timeout=30)
    if not ok:
        return _scan_cache
    best = {}
    for line in out.splitlines():
        parts = _split(line) + ["", ""]
        ssid = parts[0]
        if not ssid or ssid == S.AP_SSID:
            continue
        sig = int(parts[1]) if parts[1].isdigit() else 0
        if ssid not in best or sig > best[ssid]["signal"]:
            best[ssid] = {"ssid": ssid, "signal": sig, "secure": parts[2] not in ("", "--")}
    _scan_cache = sorted(best.values(), key=lambda n: -n["signal"])
    return _scan_cache


def start_ap():
    scan()  # selagi radio masih bebas
    _nm("con", "delete", S.AP_CON)
    ok, out = _nm(
        "con", "add", "type", "wifi", "ifname", S.WIFI_IFACE, "con-name", S.AP_CON,
        "autoconnect", "no", "ssid", S.AP_SSID,
        "802-11-wireless.mode", "ap", "802-11-wireless.band", "bg",
        "802-11-wireless.channel", "6",
        "ipv4.method", "shared", "ipv4.addresses", f"{S.AP_IP}/24",
        "ipv6.method", "disabled",
        "wifi-sec.key-mgmt", "wpa-psk", "wifi-sec.proto", "rsn",
        "wifi-sec.pairwise", "ccmp", "wifi-sec.group", "ccmp",
        "wifi-sec.pmf", "disable", "wifi-sec.psk", S.DEVICE_KEY,
    )
    if ok:
        ok, out = _nm("con", "up", S.AP_CON)
    if ok and S.MOCK:
        _mock.update(mode="ap", ssid=S.AP_SSID, ip=S.AP_IP)
    return ok, out


def stop_ap():
    _nm("con", "down", S.AP_CON)


def connect_saved():
    """Coba semua profil WiFi tersimpan. True kalau salah satu berhasil."""
    for name in wifi_profiles():
        ok, _ = _nm("-w", "35", "con", "up", name, timeout=50)
        if ok:
            if S.MOCK:
                _mock.update(mode="sta", ssid=name, ip="192.168.1.50")
            return True
    return False


def apply_wifi(ssid, psk="", hidden=False):
    """Coba WiFi baru. Profil lama baru dihapus SETELAH yang baru terbukti konek,
    jadi kalau gagal pemanggil masih bisa connect_saved() ke WiFi lama."""
    new = S.WIFI_CON + "-new"
    _nm("con", "delete", new)
    args = ["con", "add", "type", "wifi", "ifname", S.WIFI_IFACE, "con-name", new,
            "autoconnect", "yes", "ssid", ssid]
    if hidden:
        args += ["802-11-wireless.hidden", "yes"]
    if psk:
        args += ["wifi-sec.key-mgmt", "wpa-psk", "wifi-sec.psk", psk]
    ok, out = _nm(*args)
    if not ok:
        return False, out
    stop_ap()
    ok, out = _nm("-w", "35", "con", "up", new, timeout=50)
    if not ok:
        _nm("con", "delete", new)
        return False, out or "gagal konek"
    for name in wifi_profiles():
        if name != new:
            _nm("con", "delete", name)
    _nm("con", "modify", new, "connection.id", S.WIFI_CON)
    if S.MOCK:
        _mock.update(mode="sta", ssid=ssid, ip="192.168.1.50", profiles=[S.WIFI_CON])
    return True, ""


def forget_all():
    for name in wifi_profiles():
        _nm("con", "delete", name)
    if S.MOCK:
        _mock["profiles"] = []
