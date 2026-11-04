"""Baca/tulis config. defaults.json tidak pernah diubah; reset = kembali ke sana."""
import json
import os
import threading

from settings import CONFIG_PATH, DATA_DIR, DEFAULTS_PATH

_lock = threading.Lock()


def _defaults():
    with open(DEFAULTS_PATH) as f:
        return json.load(f)


def _merge(base, over):
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _merge(base[k], v)
        else:
            base[k] = v
    return base


def load():
    """Config = defaults ditimpa isi config.json. File rusak/hilang -> defaults."""
    cfg = _defaults()
    try:
        with open(CONFIG_PATH) as f:
            _merge(cfg, json.load(f))
    except (OSError, ValueError):
        pass
    return cfg


def save(cfg):
    """Tulis atomik supaya listrik mati di tengah jalan tidak merusak file."""
    with _lock:
        os.makedirs(DATA_DIR, exist_ok=True)
        tmp = CONFIG_PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump(cfg, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, 0o600)
        os.replace(tmp, CONFIG_PATH)


def reset():
    save(_defaults())
