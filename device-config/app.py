from flask import Flask, render_template

app = Flask(__name__)


@app.route("/")
def login():
    # Mock data untuk simulasi
    return render_template(
        "login.html",
        S={"AP_SSID": "GAMABMS SETUP"},
        csrf="dummy_csrf_token",
    )


@app.route("/index")
def index():
    # Mock data untuk tampilan dashboard
    cfg = {
        "device_name": "GAMABMS-01",
        "mqtt": {"host": "broker.hivemq.com", "port": 1883, "base_topic": "home"},
        "app": {"interval_s": 60},
    }
    state = {
        "mode": "ap",
        "ssid": "",
        "ip": "192.168.4.1",
        "last_error": None,
    }
    return render_template(
        "index.html",
        cfg=cfg,
        state=state,
        S={
            "DEVICE_ID": "GAMABMS-001",
            "AP_SSID": "GAMABMS-HOTSPOT",
            "HOLD_RESET_S": 5,
        },
        csrf="dummy_csrf_token",
        nets=[
            {"ssid": "WiFi_Rumah", "signal": 80, "secure": True},
            {"ssid": "Tamu_Free", "signal": 60, "secure": False},
        ],
        default_pw=False,
    )


if __name__ == "__main__":
    app.run(debug=True, port=5000)
