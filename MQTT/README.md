# MQTT/ — Broker Mosquitto

Broker milik repo ini (bagian dari root `docker-compose.yml`). Kontrak topik/payload: [`docs/MQTT-CONTRACT.md`](../docs/MQTT-CONTRACT.md).

```
MQTT/
├── Dockerfile                    # eclipse-mosquitto:2.0.22 (di-pin), config + ACL di-bake (owner mosquitto, 0600), HEALTHCHECK
├── docker-compose.yml            # service "mosquitto" (container bms-mqtt), TANPA port publik
├── docker-compose.public.yml     # override OPSIONAL: publish 1883 ke internet (sementara, untuk ESP32)
├── config/
│   ├── mosquitto.conf            # listener, auth, batas, persistence, log
│   ├── acl_file                  # ACL berbasis peran (aktif)
│   └── acl_file.per-device.example   # ACL per device (BELUM aktif)
├── secrets/                      # (gitignored) password_file — dibuat oleh init-passwd.sh
└── scripts/
    ├── init-passwd.sh            # membuat password_file tanpa menulis password ke repo
    ├── add-device-user.sh        # menambah user per device (tahap berikutnya)
    └── verify-broker.sh          # uji auth/ACL/batas pada broker SEKALI-PAKAI
```

## 1. Pertama kali

```bash
MQTT/scripts/init-passwd.sh          # user default: esp32_device dan backend_service
```
Password diminta lewat prompt tersembunyi (atau env `MQTT_PASSWORD_ESP32_DEVICE`, `MQTT_PASSWORD_BACKEND_SERVICE`), minimal 12
karakter, di-hash oleh `mosquitto_passwd` di container sementara. Password **tidak** ditulis ke repo, tidak muncul di argumen proses
host, dan tidak dicetak. Hasil: `MQTT/secrets/password_file` (di-gitignore).

Di VPS (Linux) jalankan skrip dengan `sudo` supaya file menjadi milik uid `mosquitto` (1883) mode `0600`; tanpa root, skrip memakai
`0644` (isinya hash PBKDF2-SHA512) dan Mosquitto akan mencatat peringatan *world readable*.

Isi password backend juga ke `BE/.env.production` (`MQTT_USERNAME=backend_service`, `MQTT_PASSWORD`, `MQTT_BROKER_URL=mqtt://bms-mqtt:1883`).

**Bila Anda sebelumnya punya `MQTT/config/password_file`:** pindahkan ke `MQTT/secrets/password_file` (lokasi mount berubah).
Bila `password_file` hilang, broker **gagal start** dengan pesan `Unable to open pwfile` (bukan diam-diam membuat direktori seperti sebelumnya).
Kalau ada direktori bernama `password_file` (sisa perilaku lama Docker), hapus dengan `rmdir`.

## 2. Menjalankan & akses

```bash
docker compose up -d mosquitto            # dari root repo; hanya bisa dijangkau service di network bms-network
docker compose ps                         # STATUS harus healthy
```

| Mode | Perintah | Siapa yang bisa terhubung |
|---|---|---|
| **Internal (default)** | `docker compose up -d` | hanya container di `bms-network` (backend → `bms-mqtt:1883`) |
| **Publik sementara** | `docker compose -f docker-compose.yml -f MQTT/docker-compose.public.yml up -d` | siapa pun yang tahu host:1883 **dan** kredensial (ESP32) |

**Keputusan proyek:** ESP32 mencapai broker lewat port publik **1883 + ACL, sementara**. Konsekuensi: **tanpa TLS** — username/password
dan payload terkirim cleartext. Perlindungan yang ada: `allow_anonymous false`, ACL peran, batas ukuran/koneksi, batas auto-provision
di backend. **Cloudflare Tunnel tidak bisa dipakai untuk ESP32** (perangkat tidak menjalankan `cloudflared`; TCP mentah tanpa agen adalah
produk berbayar). Rekaman DNS broker harus *DNS only*, bukan *proxied*.

### Firewall
Docker mem-publish port lewat aturan iptables sendiri sehingga `ufw allow/deny` **tidak** memblokir port yang di-publish Docker.
Untuk membatasi ke IP device yang statis, pakai rantai `DOCKER-USER`, mis.:
```bash
sudo iptables -I DOCKER-USER -p tcp --dport 1883 ! -s <IP-device> -j DROP
```
(persisten lewat `iptables-persistent`/`netfilter-persistent`). Bila IP device dinamis, lewati langkah ini dan andalkan ACL + batas.

## 3. ACL (peran)

| User | Boleh | Ditolak |
|---|---|---|
| `esp32_device` | **menulis** `bms/+/data`, `bms/+/status` | membaca apa pun; menulis topik lain (mis. `bms/X/cmd`, `bms/X/data/extra`) |
| `backend_service` | **membaca** `bms/#` | menulis apa pun; membaca `$SYS/#` dan topik lain |
| selain itu | — | semua (default deny; anonim ditolak) |

Catatan perilaku Mosquitto: subscribe ke topik **tanpa** hak baca tetap dijawab SUBACK "granted"; ACL `read` ditegakkan saat
**pengiriman** — pesan tidak akan pernah sampai. Publish ke topik tanpa hak tulis dibuang (klien MQTT v5 QoS 1 menerima "Not authorized").

ACL di-bake ke image: **mengubah `config/acl_file` = build ulang image** (`docker compose up -d --build mosquitto`).

### Tahap berikutnya: user per device (belum aktif)
Butuh firmware yang menyimpan kredensial unik per unit (NVS) dan memakai `username = device_id`.
1. `MQTT/scripts/add-device-user.sh <device_id> --generate` → password acak ke `MQTT/provisioning/<id>.credentials` (0600, gitignored, tidak dicetak).
2. Ganti `config/acl_file` dengan `config/acl_file.per-device.example` (pola `%u`), hapus user bersama `esp32_device`, build ulang, `docker compose kill -s SIGHUP mosquitto`.

## 4. Batas (config/mosquitto.conf)

| Opsi | Nilai | Alasan |
|---|---|---|
| `message_size_limit` | 65536 | sama dengan batas payload di kontrak MQTT |
| `max_connections` | 200 | melindungi dari banjir koneksi |
| `max_queued_messages` / `max_inflight_messages` | 1000 / 20 | membatasi memori per sesi |
| `max_keepalive` | 300 | klien MQTT 3.1.1 yang meminta keepalive > 300 dtk **ditolak** (`identifier rejected`) — diverifikasi |
| `persistent_client_expiration` | 7d | membuang sesi persisten yang tidak kembali |
| `allow_zero_length_clientid` | false | klien wajib mengirim client-id (ESP32 memang selalu mengirim) |
| `log_type` | error, warning, notice | tanpa level `information` yang sangat verbose |

**Untuk firmware:** keepalive ≤ 300 detik (umum 15–60), client-id tidak kosong, payload ≤ 64 KiB.

## 5. Verifikasi

```bash
MQTT/scripts/verify-broker.sh      # broker SEKALI-PAKAI di network Docker sementara; tidak menyentuh broker produksi
```
Memeriksa 20 hal: pembuatan password_file (hash, bukan plaintext), healthcheck, anonim/password salah ditolak, publish sah lolos dan
sampai ke backend, publish ke topik terlarang ditolak, backend tidak bisa publish, esp32 tidak menerima pesan, `$SYS` tertutup,
payload 60 KB lolos dan 70 KB tidak diteruskan, keepalive, proses bukan root, log startup bersih.

## 6. Simulator perangkat

`IoT/bms_publisher.py` membaca konfigurasi dari environment (tidak ada kredensial di file) dan **memakai akun `esp32_device`**
(akun `backend_service` sengaja tidak boleh menerbitkan):
```bash
MQTT_BROKER_HOST=<host> MQTT_PASSWORD=<password esp32_device> DEVICE_ID=GAMA-BMS-PACK-001 python3 IoT/bms_publisher.py
```

## 7. Troubleshooting

| Gejala | Penyebab / tindakan |
|---|---|
| Container restart-loop, log `Unable to open pwfile` | `MQTT/secrets/password_file` belum ada → `MQTT/scripts/init-passwd.sh` |
| Log `Warning: ... world readable permissions` | file dibuat non-root; di VPS: `sudo chown 1883:1883 MQTT/secrets/password_file && sudo chmod 0600 ...` |
| Klien ditolak `not authorised` | user/password salah (cek `MQTT_USERNAME/PASSWORD`) |
| Klien ditolak `identifier rejected` | client-id kosong atau keepalive > 300 |
| Data tidak masuk padahal publish "berhasil" | topik/ACL: hanya `bms/{id}/data` dan `bms/{id}/status`; cek counter `mqtt.invalid*` di `/api/health` backend |
