p = "main.py"; s = open(p).read()
old = '''            cfg = config_store.load()
            lines = [cfg["device_name"], f"WiFi: {state['ssid']}", state["ip"],
                     f"MQTT: {cfg['mqtt']['host'] or '-'}", f"ID: {S.DEVICE_ID}"]
'''
new = '''            lines = app_lines()
            if lines:
                lines = lines[:4] + [state["ip"]]
            else:
                cfg = config_store.load()
                lines = [cfg["device_name"], f"WiFi: {state['ssid']}", state["ip"],
                         f"MQTT: {cfg['mqtt']['host'] or '-'}", f"ID: {S.DEVICE_ID}"]
'''
helper = '''def app_lines():
    """Baris OLED titipan aplikasi utama; None kalau tidak ada atau basi (>30 dtk)."""
    try:
        if time.time() - os.path.getmtime("/run/bms-display.json") > 30:
            return None
        with open("/run/bms-display.json") as f:
            return [str(x) for x in json.load(f)]
    except (OSError, ValueError):
        return None


def display_loop():
'''
assert old in s and "def app_lines" not in s, "main.py berbeda dari perkiraan"
s = s.replace(old, new, 1).replace("def display_loop():\n", helper, 1)
open(p, "w").write(s)
t = open("settings.py").read().replace('APP_SERVICE = ""', 'APP_SERVICE = "adb-bms"')
open("settings.py", "w").write(t)
print("PATCH OK")
