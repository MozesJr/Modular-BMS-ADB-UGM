# Runbook Fase B (Gelombang 1) + Fase M + upgrade dependency — langkah manual

Branch: `feat/mobile-api-v1`. Format sama dengan [PHASE-A-RUNBOOK.md](./PHASE-A-RUNBOOK.md) (Fase A sudah Anda terapkan).
**Tidak ada langkah di sini yang sudah dijalankan ke DB/server/broker nyata** — semuanya untuk Anda eksekusi.
Jangan menempelkan isi `.env*`, `password_file`, atau password ke chat/commit.

## 0. Apa yang berubah sejak Fase A

| Blok | Isi | Yang perlu Anda lakukan |
|---|---|---|
| Upgrade | Node 22 (Dockerfile BE+FE), `next` (BE 15.5.25, FE 16.3.5), `nodemailer` 10, `next-auth` beta.32 | Build ulang image; **kirim satu email reset password nyata** setelah deploy (tes tidak memakai SMTP asli) |
| **Fase M** (`MQTT/`) | Broker repo jadi sumber kebenaran: ACL peran, batas, healthcheck, tanpa port publik default, `secrets/password_file`, batas auto-provision | **Bagian 3** (paling berisiko — menyentuh perangkat ESP32) |
| M0 (kontrak) | `temperature` boleh `null`; suhu di luar rentang → `null` (pesan tidak ditolak) | Beri tahu tim firmware (opsional) |
| B1 | OpenAPI + CI | — |
| B2 | Token mobile (`/api/v1/auth/*`) | **`JWT_ACCESS_SECRET` WAJIB** (server tidak start tanpa itu) + 1 migrasi |
| B3–B5 | `/me`, `/devices`, dashboard, riwayat, collaborator | — |
| B4 | Rollup + skrip retensi | 1 migrasi + **jadwalkan skrip** (Bagian 6) |
| B6b/B7c | Beranda web nyata; FE me-rewrite `/api/v1/*` ke BE | Deploy FE bersama BE |

## 1. Prasyarat
- [ ] **Backup DB:** `pg_dump -Fc -h <host> -U <user> <db> > backup-$(date +%F).dump`
- [ ] Fase A sudah terpasang dan berjalan (3 migrasi `20260921…` sudah applied).
- [ ] Domain + TLS (Cloudflare Tunnel) — lihat Bagian 5. Mobile rilis menolak HTTP polos.
- [ ] Jam sepi (migrasi `add_history_rollups` cepat karena tabel baru; tidak mengunci tabel history).

## 2. Migrasi Prisma (2 baru, additive)

| Migrasi | Isi | Risiko |
|---|---|---|
| `20260922100000_add_refresh_token` | tabel `RefreshToken` (hash saja) | instan, tabel baru |
| `20260922110000_add_history_rollups` | tabel `PackRollup1m`, `CellRollup1m` (kosong sampai skrip retensi jalan) | instan, tabel baru |

Aman untuk kode lama (hanya menambah tabel). Jalankan **sebelum** deploy kode baru:
```bash
cd /home/Modular-BMS-ADB-UGM
git pull origin feat/mobile-api-v1            # atau merge ke main dulu
docker compose build backend-migrate
docker compose --profile tools run --rm backend-migrate      # = prisma migrate deploy
```
Verifikasi: `SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 5;`

## 3. Broker MQTT (Fase M) — ubah dengan hati-hati, ESP32 terdampak

Keputusan Anda: **container `MQTT/` repo ini = broker produksi**; ESP32 lewat **port publik 1883 + ACL, sementara**.

### 3.1 Sebelum mengganti broker — periksa keadaan saat ini
```bash
docker ps --format '{{.Names}}\t{{.Ports}}' | grep -i mosquitto     # broker mana yang hidup? (bms_mosquitto milik master_db vs bms-mqtt milik repo)
```
Hanya **satu** broker yang boleh memegang port 1883 host. Bila broker lama (`bms_mosquitto`, project master_db) masih melayani ESP32,
rencanakan jendela peralihan: hentikan yang lama → nyalakan `bms-mqtt`. Sinkronkan `BE/.env.production`: `MQTT_BROKER_URL=mqtt://bms-mqtt:1883`.

### 3.2 Buat password file (rahasia; tidak ada di repo)
```bash
sudo MQTT/scripts/init-passwd.sh          # user: esp32_device, backend_service (prompt tersembunyi; min 12 karakter)
# bila Anda punya MQTT/config/password_file lama: password_file BARU ada di MQTT/secrets/ (lokasi mount berubah)
```
`sudo` membuat file milik uid 1883 mode 0600 (tanpa `sudo` → 0644 + peringatan *world readable*, tetap berfungsi).
Isi password `backend_service` ke `BE/.env.production` (`MQTT_USERNAME=backend_service`, `MQTT_PASSWORD=…`).

### 3.3 Yang berubah untuk perangkat (firmware/simulator) — cek SEBELUM peralihan
- [ ] Perangkat memakai user **`esp32_device`** (BUKAN `backend_service`: user itu kini read-only). `IoT/bms_publisher.py` membaca kredensial dari env.
- [ ] Publish hanya ke `bms/{id}/data` dan `bms/{id}/status`; topik lain ditolak.
- [ ] **Client-id tidak kosong**, **keepalive ≤ 300 detik** (3.1.1 dengan nilai lebih besar ditolak "identifier rejected"), payload ≤ 64 KiB.
- [ ] Bila password `esp32_device` berubah: flash/konfigurasi ulang perangkat.
- [ ] Device baru ke broker: **daftarkan dulu** (`POST /devices` dengan serial-nya) atau naikkan `PROVISION_MAX_PER_HOUR` (default 20/jam; `0` = hanya serial terdaftar).

### 3.4 Nyalakan
```bash
# verifikasi konfigurasi pada broker SEKALI-PAKAI (tidak menyentuh produksi):
MQTT/scripts/verify-broker.sh                                   # harus: 20 pass, 0 fail
# produksi, internal saja (BE ke broker lewat bms-network):
docker compose up -d --build mosquitto
# membuka ke ESP32 di internet (sementara, tanpa TLS!):
docker compose -f docker-compose.yml -f MQTT/docker-compose.public.yml up -d mosquitto
```
Firewall (Docker mem-bypass `ufw`): bila IP device statis → `sudo iptables -I DOCKER-USER -p tcp --dport 1883 ! -s <IP> -j DROP` (lihat `MQTT/README.md`).
Cloudflare Tunnel **tidak** bisa dipakai untuk ESP32; DNS broker harus *DNS only*.

## 4. Environment baru (`BE/.env.production`; nama saja, isi sendiri)

| Variabel | Wajib? | Keterangan |
|---|:-:|---|
| **`JWT_ACCESS_SECRET`** | **ya** | ≥ 32 karakter, **berbeda** dari `NEXTAUTH_SECRET`; `openssl rand -base64 48`. Server **menolak start** bila kosong/pendek/sama. |
| `ACCESS_TOKEN_TTL_SEC` / `REFRESH_TOKEN_TTL_SEC` / `REFRESH_FAMILY_MAX_SEC` | tidak | default 900 / 2.592.000 / 7.776.000 |
| `PROVISION_MAX_PER_HOUR` | tidak | default 20; `0` = auto-provision mati |
| `DEVICE_ONLINE_THRESHOLD_SEC` | tidak | default 180 (3× interval publish 60 dtk) |
| `RAW_RETENTION_DAYS` | tidak | default 30 (dipakai riwayat + skrip retensi) |
| `RATE_LIMIT_IP_HEADER` | tidak | default `x-real-ip` |
| `APP_URL`, `DATABASE_URL …connection_limit=10`, `MQTT_*` | ya | dari Fase A / Bagian 3 |

**Rotasi `JWT_ACCESS_SECRET`** (bila bocor): ganti nilainya lalu restart BE → semua access token mobile invalid seketika; klien otomatis refresh
(refresh token tidak bergantung pada secret ini) dan lanjut. Untuk memutus total: `POST /api/v1/auth/logout-all` per user atau `UPDATE "User" SET "tokenVersion"="tokenVersion"+1`.

## 5. Domain, TLS, dan jalur mobile

Jalur: **mobile → Cloudflare (TLS) → cloudflared di VPS → Nginx :80 → FE :3001 → (rewrite `/api/v1/*`) → BE :4000**. BE tidak diexpose.
1. Buat Cloudflare Tunnel untuk hostname API (mis. `api.example.com`), ingress ke `http://localhost:80` (Nginx).
2. Di `/etc/nginx/sites-available/bms-adb.conf` **aktifkan** dua baris `set_real_ip_from 127.0.0.1;` / `real_ip_header CF-Connecting-IP;`
   (lihat komentar di `deploy/nginx/bms-adb.conf`). Tanpa ini semua pengguna terlihat sebagai satu IP oleh rate limiter.
3. `APP_URL` dan `NEXTAUTH_URL` → `https://<domain>`. Cookie web otomatis menjadi `Secure` di HTTPS.
4. `sudo nginx -t && sudo systemctl reload nginx`.

## 6. Deploy + jadwal retensi

BE dan FE **dideploy bersamaan** (FE me-rewrite `/api/v1/*`; format error berubah sejak Fase A):
```bash
docker compose up -d --build
docker compose ps                                              # backend & mosquitto: healthy
docker compose exec backend wget -qO- http://127.0.0.1:4000/api/health
```
**Retensi + rollup** (raw 30 hari, rollup 1 menit disimpan 365 hari). Default **dry-run** — jalankan dulu dan baca laporannya:
```bash
docker compose exec -T backend node dist/scripts/retention.js             # dry-run: hanya menghitung
docker compose exec -T backend node dist/scripts/retention.js --execute   # menulis rollup, lalu menghapus raw > 30 hari
```
Aman diulang (idempoten; rollup dihitung ulang, raw baru dihapus setelah rentangnya ter-rollup pada run yang sama). Jalankan `--execute` pertama kali
saat sepi bila riwayat besar (rollup backlog diproses per 6 jam data). Jadwalkan harian (host, `crontab -e`):
```
10 3 * * *  cd /home/Modular-BMS-ADB-UGM && docker compose exec -T backend node dist/scripts/retention.js --execute >> /var/log/bms-retention.log 2>&1
```
Sebelum run pertama pastikan sudah ada backup (Bagian 1): penghapusan raw tidak bisa dibatalkan (data lama tetap ada sebagai rollup 1 menit).

## 7. Verifikasi pasca-deploy
- [ ] `docker compose ps` — semua `healthy`; `/api/health` → `status: ok` (bukan `degraded`: MQTT terhubung).
- [ ] **Web:** login, beranda menampilkan angka nyata (bukan "3 Units / 84.2%"), tabel "Device Saya", grafik berlabel DEMO.
- [ ] **Sesi web lama tetap valid** (tokenVersion tidak berubah oleh deploy).
- [ ] **Mobile/API dari luar:**
```bash
curl -s https://<domain>/api/v1/auth/login -H 'content-type: application/json' -d '{"email":"<user>","password":"<pass>"}'   # 200 + accessToken
curl -s https://<domain>/api/v1/me -H "authorization: Bearer <accessToken>"                                                  # 200
curl -s https://<domain>/api/v1/devices?limit=5 -H "authorization: Bearer <accessToken>"
```
- [ ] Rate limit memakai IP asli: dua pengguna dari IP berbeda tidak saling menghambat (`docker compose logs backend | grep RATE`).
- [ ] MQTT: `curl -s …/api/health | jq .counters` — `mqtt.stored` naik; `mqtt.invalid.*`, `mqtt.provision_limited`, `mqtt.sensor_fault` dipantau; ACL menolak klien salah (`docker compose logs mosquitto`).
- [ ] Email reset password nyata terkirim (setelah upgrade nodemailer 10).
- [ ] Retensi dry-run tampil wajar; cron terpasang.
- [ ] Bagikan `docs/openapi.json` + `docs/API-GUIDE.md` ke pengembang mobile.

## 8. Rollback
- **Kode:** deploy commit sebelumnya (`git checkout <sha>`, `docker compose up -d --build`). Migrasi Fase B hanya menambah tabel; kode lama berjalan normal dengan schema baru.
- **MQTT:** `docker compose up -d mosquitto` tanpa override kembali ke internal-saja; untuk kembali ke broker lama, hentikan `bms-mqtt` dan nyalakan `bms_mosquitto`.
- **Mobile:** rollback menghentikan endpoint `/api/v1/*`; klien mobile akan menerima 404 — koordinasikan dengan pengembang mobile.
- **Data:** restore backup hanya bila perlu; **penghapusan raw oleh retensi tidak bisa dibatalkan** (rollup tetap ada).

## 9. Risiko & catatan tersisa
- Rate limiter, antrean ingestion, dan batas auto-provision **in-memory** (satu instance); restart mengosongkannya.
- Port 1883 publik = **tanpa TLS** (kredensial dan payload cleartext) — jembatan sementara; TLS 8883 + user per device adalah tahap berikut (`MQTT/README.md`).
- Klien MQTT backend masih `clientId` acak + clean session: pesan yang dipublish saat BE mati hilang (dibereskan di B6, Gelombang 2).
- Riwayat `voltage` per cell menghasilkan banyak seri; API membatasi ~20.000 titik (klien harus memilih bucket sesuai rentang).
- `npm audit` BE: sisa `postcss`/`sharp` berasal dari `next` sendiri (menunggu rilis upstream); `next-auth` beta.32 tetap versi beta.
- FE ESLint: 10 error pra-ada (bukan gerbang CI).
- Belum ada: WebSocket terautentikasi, modul alert, registrasi device token push, status/LWT — **Gelombang 2**.
