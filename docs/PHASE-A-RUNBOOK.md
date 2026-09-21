# Runbook Fase A — langkah manual (migrasi & deploy)

Branch: `feat/mobile-api-v1`. Tidak ada langkah di sini yang sudah dijalankan ke DB/server nyata; semuanya untuk Anda eksekusi.
Jangan menempelkan isi `.env*` atau password ke chat/commit.

## 0. Prasyarat
- [ ] Backup DB: `pg_dump -Fc -h <host> -U <user> <db> > backup-$(date +%F).dump`
- [ ] Cek ukuran tabel history (menentukan lama kunci tulis saat migrasi): `SELECT count(*) FROM "PackHistory"; SELECT count(*) FROM "CellHistory";`
- [ ] Pilih jam sepi (migrasi 2 membuat unique index dan mengunci TULIS tabel history selama pembuatan).

## 1. Migrasi Prisma (4 baru, urut)
| Migrasi | Isi | Risiko |
|---|---|---|
| `20260921120000_add_user_token_version` | kolom `User.tokenVersion` (default 0) | instan |
| `20260921130000_ingestion_idempotency` | kolom `Pack.recordedAt/receivedAt`, `PackHistory.receivedAt`; **DELETE baris history duplikat**; unique index history; hapus 2 index lama | kunci tulis history; **menghapus duplikat** (backup!) |
| `20260921140000_history_current_power_and_indexes` | kolom `PackHistory.current/power`; 4 index baru | kunci tulis sesaat per index |

Jalankan **sebelum** deploy kode baru (aman untuk kode lama: semua kolom baru nullable/berdefault; unique index tidak mengganggu insert kode lama kecuali duplikat yang memang ingin dibuang):
```bash
cd /home/Modular-BMS-ADB-UGM        # di VPS
git pull origin feat/mobile-api-v1  # atau merge ke main terlebih dulu
docker compose build backend-migrate
docker compose --profile tools run --rm backend-migrate   # = prisma migrate deploy
```
Verifikasi: `SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 4;`

## 2. Environment di VPS (`BE/.env.production`; nama variabel saja, isi sendiri)
- `APP_URL` — origin publik FE (**wajib**, tanpa ini email reset tidak terkirim; ada log `forgot_password.app_url_missing`)
- `PORT=4000` (default kode kini 4000)
- `DATABASE_URL` — tambahkan `&connection_limit=10`
- `MQTT_BROKER_URL` — sesuai keputusan "container `MQTT/` repo": `mqtt://bms-mqtt:1883` (**cek** nama container yang benar-benar hidup; `docker ps`)
- Opsional: `RATE_LIMIT_IP_HEADER`, `INGEST_CONCURRENCY`, `INGEST_MAX_PER_DEVICE`, `INGEST_MAX_TOTAL`
- **Nginx**: `proxy_set_header X-Real-IP $remote_addr;` sudah ada di `deploy/nginx/bms-adb.conf`. Bila nanti lewat Cloudflare Tunnel → Nginx, tambahkan `set_real_ip_from 127.0.0.1; real_ip_header CF-Connecting-IP;` (kalau tidak, semua pengguna berbagi satu bucket rate limit).

## 3. Deploy
BE dan FE **dideploy bersamaan** (format error BE berubah; FE baru membaca format lama dan baru, FE lama menampilkan "[object Object]" pada pesan error registrasi/reset).
```bash
docker compose up -d --build
docker compose ps                                   # backend harus "healthy" setelah ±40 dtk
docker compose exec backend wget -qO- http://127.0.0.1:4000/api/health
```
Health: `status: ok` (DB+MQTT) / `degraded` (MQTT putus) / `down` (DB mati).

## 4. Verifikasi pasca-deploy
- [ ] Login web normal; **semua sesi web lama tetap valid** (JWT lama tanpa `tv` dianggap versi 0). Setelah reset password, sesi lama user itu mati (by design).
- [ ] `curl -s .../api/health | jq .counters` — pantau `mqtt.invalid`, `mqtt.invalid.schema`, `mqtt.clock_skewed`, `mqtt.dropped`, `mqtt.failed`. Lonjakan `mqtt.invalid.schema` = firmware mengirim nilai di luar rentang kontrak (lihat `docs/MQTT-CONTRACT.md`).
- [ ] `docker compose logs backend | grep -E '"level":"(warn|error)"'`
- [ ] Data device baru masuk ke history dan grafik FE; kolom `PackHistory.current/power` terisi untuk firmware yang mengirimnya.
- [ ] Coba login salah >10x → 429; registrasi email yang sudah ada → tetap 202.

## 5. Uji lokal yang bisa Anda ulang
```bash
cd BE && npm run test:db     # Postgres sekali-pakai di Docker + seluruh tes (73)
```

## 6. Rollback
- Kode: deploy commit sebelumnya (`git checkout <sha>`, `docker compose up -d --build`). Migrasi bersifat additive kecuali langkah DELETE duplikat + penggantian index history (tidak perlu di-rollback; kode lama berjalan normal dengan schema baru).
- Data: restore dari backup langkah 0 hanya bila perlu.

## 7. Diketahui / belum ditangani di Fase A
- Rate limiter & antrean ingestion **in-memory** (satu instance); restart mengosongkan keduanya.
- Klien MQTT memakai `clientId` acak + clean session → pesan yang dipublish saat BE mati tidak dikirim ulang (dibahas di B6).
- `MQTT/` (F-05/F-19/F-25: ACL, TLS, mount `password_file`, port publik) belum disentuh.
- Node 20 EOL dan advisory `next`/`next-auth`/`nodemailer` belum di-upgrade (perlu keputusan).
- FE: 10 error ESLint pra-ada tidak berubah; dashboard beranda masih data hardcode (disambungkan di Fase B).
