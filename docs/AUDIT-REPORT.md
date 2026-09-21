# AUDIT REPORT — Modular Universal BMS Dashboard

- **Tanggal audit:** 2026-09-21
- **Commit yang diaudit:** `fb1da4b` (branch `main`, working tree bersih)
- **Sifat audit:** read-only. Satu-satunya file yang dibuat adalah dokumen ini.
- **Catatan struktur:** folder aktual adalah `BE/`, `FE/`, `MQTT/` (huruf besar) dan `IoT/` (skrip publisher dummy, tidak disebut di brief). Laporan memakai nama aktual.
- **Aturan secret:** tidak ada nilai secret di dokumen ini. Hanya nama file, baris, dan nama variabel.

> **Pengakuan proses:** dua perintah pemeriksaan saya (`awk` pada `MQTT/config/password_file.txt` dan `grep` pada `IoT/bms_publisher.py`) sempat menampilkan nilai kredensial di output tool pada sesi ini, karena redaksi saya meleset. Nilainya tidak masuk laporan. Kredensial itu memang sudah harus dirotasi (P0), jadi dampak tambahan praktis nol, tetapi transkrip sesi ini sebaiknya jangan dibagikan.

**Cara membaca "fakta vs dugaan":** semua temuan berlabel **[F]** = terlihat langsung di kode/konfigurasi. Berlabel **[V]** = dugaan / *perlu diverifikasi* (biasanya karena bergantung pada kondisi VPS, visibilitas repo, atau firmware yang tidak ada di repo).

---

## 1. Ringkasan Eksekutif

Arsitektur dasarnya masuk akal dan kodenya rapi untuk skala capstone: `tsc --noEmit` bersih di BE dan FE, ada ownership check pada endpoint device, password di-hash bcrypt cost 12, reset-token di-hash + sekali pakai + kedaluwarsa 1 jam, FE hanya bind ke `127.0.0.1`. Namun ada masalah serius yang harus dibereskan **sebelum** mobile dibangun di atasnya:

1. **Kredensial ter-commit di 5 tempat** (MQTT, Gmail App Password, NEXTAUTH_SECRET-format, cookie sesi). Semua wajib dirotasi; riwayat git wajib dibersihkan jika repo pernah/sedang publik.
2. **Kontrol akses MQTT dan WebSocket praktis tidak ada:** satu kredensial bersama, tanpa ACL/TLS; `/ws` tanpa autentikasi dan mem-broadcast telemetri *semua device* ke siapa saja yang terhubung.
3. **Ingestion rapuh:** payload tidak divalidasi, tidak idempoten, N+1 upsert dalam transaksi per pesan, tanpa antrean/backpressure; endpoint history tanpa limit/downsampling dan tanpa strategi retensi.
4. **Auth berbasis cookie-JWT 30 hari tanpa refresh/revoke;** role/expiry hanya dibaca dari JWT. Tidak ada rate limiting sama sekali.
5. **Kesiapan mobile rendah:** tidak ada token auth, versioning, pagination, OpenAPI, health endpoint, alert, atau device-token push; BE tidak terekspos publik; produksi masih HTTP tanpa TLS; realtime FE kemungkinan tidak berfungsi di produksi.
6. **Dashboard beranda FE seluruhnya data hardcode** (angka "3 Units / 84.2% / 1,240 W" bukan data nyata), 57 file TailAdmin demo + 18 file tidak terpakai, dan dependency FE/BE punya advisory critical (Next, next-auth, swiper).

### Skor kesehatan per area (1 = buruk, 5 = sangat baik)

| Area | Skor | Alasan singkat |
|---|:-:|---|
| A. Repo & infra | **2** | Multi-stage FE bagus, tapi secret ter-commit, BE jalan sebagai root, tanpa healthcheck, deploy `down`→`up` tanpa gate, compose vs MQTT tidak konsisten |
| B. MQTT | **1** | Tanpa ACL/TLS/limit; kredensial tunggal & bocor; password_file salah nama/gitignore; tanpa LWT |
| C. Backend | **3** | Struktur bersih & ownership check ada; validasi, error handling, WS authz, retensi, shutdown, rate limit belum |
| D. Frontend | **3** | UI fungsional, tipe strict; dashboard mock, bloat template, realtime rapuh, 10 error lint |
| E. Keamanan lintas layer | **2** | Praktik hashing bagus; secret bocor, tanpa TLS, tanpa rate limit, dependency critical, IDOR collaborator |
| F. Kesiapan mobile | **2** | Fondasi data ada (Device→Pack→Cell), tapi auth/kontrak/realtime/push semuanya belum |
| G. Kualitas kode & testing | **2** | TS strict lolos; 0 test, BE tanpa konfigurasi lint, FE 10 error / 17 warning |
| H. Dokumentasi | **2** | README ada tapi basi/salah (mis. "GAMA BMS 16"), tanpa kontrak payload MQTT, tanpa README BE/MQTT |

### Hasil pengecekan non-destruktif

| Perintah | Hasil |
|---|---|
| `tsc --noEmit` (BE `tsconfig.json` & `tsconfig.server.json`, FE) | Bersih, 0 error |
| `eslint .` (FE) | **10 error, 17 warning** (mayoritas `react-hooks/set-state-in-effect`; kode template ikut menyumbang) |
| `next lint` (BE) | **Tidak berfungsi:** tidak ada config ESLint, perintah masuk mode interaktif |
| `npm audit --omit=dev` BE | 6 vuln: **3 critical** (`next` 15.5.23, `next-auth` 5.0.0-beta.25 + `@auth/core`), **3 high** (`nodemailer`, `postcss`, `sharp`) |
| `npm audit --omit=dev` FE | 3 vuln: **2 critical** (`next` 16.3.1, `swiper`), 1 high (`sharp`) |
| `docker compose config -q` (root) | Gagal: `FE/.env.production` tidak ada. Wajar di clone bersih, tapi menunjukkan tidak ada validasi/skrip bootstrap env |
| Import-graph FE (skrip saya) | 135 file kode; **18 tidak terjangkau** dari entry manapun; **57 hanya terjangkau lewat halaman demo TailAdmin** |
| `docker compose up`, migrasi DB | **Tidak dijalankan** (sesuai aturan) |

---

## 2. Tabel Temuan

Severity: **P0** kritis · **P1** tinggi · **P2** sedang · **P3** rendah. Effort: S (<½ hari) · M (1–3 hari) · L (>3 hari). Label `[F]` fakta / `[V]` perlu diverifikasi. Kolom "Kontrak" menandai perubahan yang menyentuh kontrak payload MQTT / kontrak API.

### 2.1 P0 — Kritis

| ID | Area | Folder | File:baris | Masalah | Rekomendasi | Effort |
|---|---|---|---|---|---|:-:|
| **F-01** | A/B/E | IoT, MQTT | `IoT/bms_publisher.py:10-16` (host di :10, kredensial di :13-14); juga `IoT/__pycache__/bms_publisher.cpython-312.pyc` | **[F]** Alamat publik VPS + username + password MQTT hardcode & ter-commit. Username yang dipakai adalah akun `backend_service` (akun yang seharusnya hanya milik backend), sehingga siapapun yang punya repo punya hak setara backend. `.pyc` juga ter-track dan memuat string yang sama. | Rotasi password segera; baca dari env (`os.environ`) / argparse; `git rm --cached` .pyc + tambah `__pycache__/` ke `.gitignore`; bersihkan riwayat (lihat F-04). Buat user MQTT khusus untuk simulator. | S |
| **F-02** | B/E | MQTT | `MQTT/config/password_file.txt:6` dan `:12` (commit `da35a58`) | **[F]** File ini bukan password file Mosquitto; isinya *instruksi shell* yang menuliskan **password plaintext** untuk user `esp32_device` dan `backend_service` di argumen `mosquitto_passwd -b`. Ter-track di git. Selain itu `MQTT/.gitignore:1` mengabaikan `config/password_file` (tanpa `.txt`), jadi file berbahaya ini lolos dan file yang benar tidak ada di repo (lihat F-19). | Rotasi kedua password; hapus file dari repo + riwayat; ganti dengan `MQTT/README.md` yang menjelaskan cara membuat password file tanpa menuliskan password; gunakan prompt interaktif (`mosquitto_passwd -c file user`) atau env. | S |
| **F-03** | E/A | BE | `BE/.env.example:5` (`NEXTAUTH_SECRET`), `:18` (`GMAIL_APP_PASSWORD`), `:2` (`DATABASE_URL`), `:13` (`MQTT_BROKER_URL`), `:9` (`RESEND_API_KEY`) | **[V-kuat]** File *example* yang ter-track sejak 2026-08-20 berisi nilai yang **berbentuk asli**: `NEXTAUTH_SECRET` 44 karakter base64 (format persis `openssl rand -base64 32`, bukan placeholder); `GMAIL_APP_PASSWORD` 16 huruf kecil (format persis Google App Password); `DATABASE_URL` berisi `user:password@` (host localhost); `MQTT_BROKER_URL` berisi IP publik VPS. Saya tidak bisa memastikan nilai itu masih aktif tanpa mencobanya (dan tidak akan mencobanya). | Anggap **bocor**: cabut App Password di akun Google, generate `NEXTAUTH_SECRET` baru (semua sesi otomatis logout), ganti password DB. Ganti isi `.env.example` dengan placeholder eksplisit (`CHANGE_ME`). `RESEND_API_KEY` tidak dipakai kode sama sekali (0 referensi di `BE/src`); hapus. | S |
| **F-04** | E/A | root | `cookies.txt`, `cookies2.txt` (commit `da35a58`, 2026-09-09) | **[F]** Hasil `curl -c`: masing-masing memuat cookie `authjs.session-token` (JWE 563 karakter), `authjs.csrf-token`, `authjs.callback-url` untuk `localhost`. Sesi Auth.js berlaku 30 hari default, jadi token bertanggal ±8 Sep masih valid sampai ±8 Okt bila secret-nya sama. **[V]** apakah `NEXTAUTH_SECRET` dev sama dengan produksi (README mendorong secret yang sama antar BE/FE, tidak menyebut pemisahan dev/prod). | Hapus kedua file, tambah `cookies*.txt` ke `.gitignore`, rotasi `NEXTAUTH_SECRET` (F-03 sekaligus). **Bersihkan riwayat** dengan `git filter-repo` (atau BFG) untuk F-01…F-04, lalu force-push dan minta semua kontributor re-clone. Cek visibilitas repo `github.com/MozesJr/Modular-BMS-ADB-UGM`; jika pernah publik, rotasi saja tidak cukup, anggap semua nilai sudah dipanen. | M |

### 2.2 P1 — Tinggi

| ID | Area | Folder | File:baris | Masalah | Rekomendasi | Effort |
|---|---|---|---|---|---|:-:|
| **F-05** | B/E | MQTT (+BE, IoT) | `MQTT/config/mosquitto.conf:2-7`; `BE/src/mqtt/client.ts:23,62-66` | **[F]** Tidak ada ACL: siapa pun dengan kredensial valid bisa publish ke `bms/<serial-apa-saja>/data` dan subscribe `#`. Backend lalu **auto-provision** Device baru dari topik apa pun (`upsert create`), jadi satu akun MQTT bocor = bisa memalsukan telemetri device siapa saja dan mem-flood tabel `Device`/`*History`. Kredensial bersama untuk semua ESP32 (dari isi F-02). README `Known Limitations` menyebut broker VPS sempat `allow_anonymous true` + port publik **[V]** apakah sudah diperbaiki di broker produksi (config broker produksi tidak ada di repo). | Per-device username = serial + ACL (`pattern write bms/%u/data`, `pattern write bms/%u/status`), user `backend` read-only `bms/#`, satu `acl_file`. Nonaktifkan auto-provision, atau tampung ke tabel "unclaimed" terpisah dengan batas jumlah. **Butuh perubahan di mqtt + backend + docs + firmware/IoT.** | M |
| **F-06** | B/E | MQTT, deploy | `MQTT/config/mosquitto.conf:2`; `deploy/nginx/bms-adb.conf:18-35` | **[F]** Broker plaintext 1883 (tanpa listener TLS) dan Nginx hanya `listen 80` tanpa TLS: password login, cookie sesi, dan kredensial MQTT lewat internet dalam bentuk cleartext. Cookie sesi di `cookies.txt` (dev) bertanda `secure=FALSE`; di produksi HTTP hasilnya sama. Untuk mobile, App Transport Security (iOS) / cleartext policy (Android) akan menolak HTTP. | TLS di Nginx (Let's Encrypt; jika belum ada domain: beli domain murah / Cloudflare Tunnel), HSTS, redirect 80→443. Listener MQTT 8883 dengan cert (ESP32 mendukung `WiFiClientSecure`), 1883 hanya di network internal Docker. | M |
| **F-07** | C/E | BE, FE | `BE/src/server.ts:33-58`; `BE/src/lib/ws.ts:9-20`; `BE/src/mqtt/client.ts:36` | **[F]** `/ws` tanpa autentikasi; `broadcast()` mengirim setiap `bms:update` ke **semua** client (`clients.forEach`) tanpa filter owner/collaborator. Payload = data mentah dari MQTT (`...payload` di-spread apa adanya, termasuk field asing dari device). Sekarang tidak terjangkau dari internet (BE tidak dipublish; lihat F-13), tapi begitu `/ws` dibuka untuk FE/mobile, telemetri semua pengguna bocor. **Jadi P0 seketika saat `/ws` dipublikasikan.** | Autentikasi saat handshake (token/ticket, bukan query string permanen), simpan `userId` per koneksi, protokol `subscribe {deviceIds}` yang divalidasi ke DB (owner/collaborator), kirim hanya field terkurasi, heartbeat ping/pong + terminate koneksi mati, batas ukuran pesan & jumlah koneksi per user. **Kontrak WS berubah → backend + FE + mobile + docs.** | M |
| **F-08** | E/C | BE | `BE/src/lib/authz.ts:26-30, 9-20`; `BE/src/lib/auth.ts:12, 31-33, 45-53` | **[F]** (a) Role admin dan `expiresAt` hanya dibaca dari **JWT** (`session.user.role`); admin yang diturunkan atau akun yang kedaluwarsa tetap sah sampai JWT habis (default 30 hari; `maxAge` tidak diatur). Pengecekan expiry hanya di `authorize` saat login. `getValidSession` sudah melakukan 1 query user, tapi hanya `select id`. (b) Reset password / ganti password tidak mencabut sesi yang ada (tidak ada `tokenVersion`). (c) `next-auth@5.0.0-beta.25` terkena advisory "existence-based auth checks fail open" (fix ≥ beta.32) dan kode ini memang mengandalkan `if (!session?.user)`. | Di `getValidSession` `select { id, role, expiresAt, tokenVersion }` dan tolak bila expired / role berbeda / versi token beda; `session.maxAge` pendek (mis. 7 hari) atau access-token pendek (lihat bagian F). Upgrade `next-auth` ≥ beta.32. | S |
| **F-09** | E | BE | `BE/src/lib/auth.ts:20-43`; `api/auth/register/route.ts:5-26`; `api/auth/forgot-password/route.ts:6-33`; `api/auth/reset-password/route.ts:6-33` | **[F]** Tidak ada rate limiting / lockout di manapun (login, register terbuka untuk publik, forgot-password, reset). `forgot-password` memanggil Gmail SMTP secara sinkron per request: bisa dipakai membanjiri email korban dan menghabiskan kuota harian Gmail (juga membuat fitur reset mati untuk semua). bcrypt cost 12 tanpa batas → CPU DoS. Enumerasi email: `register` mengembalikan 409 "Email sudah terdaftar" (`:17`), `collaborators POST` 404 spesifik (`:44`), `forgot-password` bocor lewat selisih waktu (DB insert + `await sendMail` hanya untuk user yang ada, `:22-31`). | Rate limit per IP + per akun (mis. `rate-limiter-flexible` dengan Postgres/Redis, atau di Nginx `limit_req` sebagai lapis pertama); lockout progresif pada login; kirim email di background (queue) sehingga waktu respons konstan; hCaptcha/Turnstile pada register & forgot bila publik; ubah pesan register menjadi netral atau wajib verifikasi email. | M |
| **F-10** | C/E | BE | `BE/src/app/api/devices/[id]/collaborators/route.ts:10-24` | **[F]** **IDOR:** `GET /api/devices/:id/collaborators` hanya cek "sudah login" (`requireAuth`), tidak memverifikasi owner/collaborator. User mana pun bisa mengambil nama + email collaborator device siapa pun jika tahu/menebak `id` (cuid). Endpoint lain (`GET /devices/:id`, `/history`) sudah benar. | Panggil helper `assertCanView(deviceId, userId)` (owner atau collaborator) — refactor pengecekan yang kini di-copy di 3 file jadi satu fungsi di `authz.ts`. | S |
| **F-11** | C | BE | `BE/src/mqtt/client.ts:33, 59, 36` | **[F]** Payload MQTT tidak divalidasi (hanya `JSON.parse` + tipe TypeScript yang lenyap saat runtime). `timestamp` hilang/berformat salah → `new Date(NaN)` → error Prisma per pesan; `packs` bukan array / `cells` hilang → `TypeError`; NaN/Infinity/nilai absurd dan jumlah pack/cell tak terbatas diterima; nilai mentah di-broadcast ke WS (F-07). Pesan rusak hanya di-`console.error` tanpa penghitung/dead-letter. | Skema zod (`timestamp` int dalam jendela wajar, `packs` 1..N, `cells` 1..M, rentang voltage/suhu/arus), tolak + log terstruktur + counter metrik; broadcast dari objek hasil parse. **Sekaligus mendefinisikan kontrak payload resmi → docs + firmware.** | S |
| **F-12** | C | BE | `BE/src/mqtt/client.ts:29, 61-119`; `schema.prisma:99-127` | **[F]** Ingestion: (a) handler `async` tanpa antrean → pesan diproses paralel tanpa batas, mudah kehabisan pool Prisma & timeout transaksi interaktif (5 s default); (b) per pesan ±(1 + packs×(1+cells)) query sequential dalam satu transaksi (N+1 di sisi tulis); (c) tidak idempoten: QoS 1 (dipakai publisher, `bms_publisher.py`) bisa duplikat, dan tabel history tidak punya unique `(deviceId, packIndex, recordedAt)` → baris ganda; (d) pesan out-of-order/terlambat menimpa state "terbaru" karena upsert tanpa perbandingan waktu; (e) dua pesan pertama dari device baru bisa balapan di `device.upsert` (unique violation P2002 → pesan hilang); (f) `recordedAt` mempercayai jam device (`payload.timestamp`) tanpa `receivedAt` pembanding: ESP32 tanpa NTP/RTC mengirim 1970/kacau sehingga data tidak muncul di query "24 jam terakhir". | Antrean bounded per device (p-queue / concurrency 4-8), tulis batch: `createMany` history + satu `INSERT … ON CONFLICT DO UPDATE` untuk latest-state (atau simpan snapshot terbaru sebagai satu kolom `JSONB`); `@@unique` + `skipDuplicates`; bandingkan `recordedAt` sebelum menimpa latest; retry P2002; simpan `receivedAt` dan pakai waktu server bila selisih > toleransi. **Butuh migrasi skema + docs kontrak (semantik timestamp).** | M |
| **F-13** | C | BE | `BE/src/app/api/devices/[id]/history/route.ts:6-7, 35-38, 42-53, 55-93`; `schema.prisma:112, 126` | **[F]** Endpoint history: `hours` sampai 720 (30 hari) tanpa `limit`, tanpa downsampling, tanpa pagination; dua `findMany` penuh lalu pengelompokan di memori Node. Dengan interval 60 s dan mis. 4 pack × 4 cell: ±173 rb baris `PackHistory` + ±691 rb baris `CellHistory` untuk 30 hari **per device**, semuanya dijadikan JSON. Indeks `@@index([deviceId, packIndex, recordedAt])` kurang cocok untuk query `where deviceId & recordedAt>=x order by recordedAt` (kolom kedua `packIndex` tidak difilter) **[V]** cek `EXPLAIN ANALYZE`. Tidak ada retensi/cleanup sama sekali: tabel tumbuh tanpa batas (PK `cuid` acak juga membengkakkan index). | Parameter `from`/`to`/`bucket` (`raw|1m|5m|1h`) dengan agregasi SQL (`date_bin`/`time_bucket`: avg/min/max), batas titik maksimum (mis. 1.000/series), cursor pagination untuk `raw`; indeks `(deviceId, recordedAt)`; job retensi (raw 30 hari, rollup 1 menit/1 jam lebih lama) atau partisi bulanan/TimescaleDB **[V]** apakah Postgres bersama (`master_postgresql`) boleh memasang extension. **Kontrak API berubah → backend + FE + mobile + docs.** | L |
| **F-14** | C/F | BE, FE | `schema.prisma:99-113` (PackHistory tidak punya `current`/`power`); `schema.prisma:79-80` | **[F]** `current` dan `power` hanya disimpan sebagai *latest state* di `Pack`; **tidak ada riwayatnya**, sehingga grafik daya/arus (yang justru inti fitur mobile & dashboard "Power Flow") tidak mungkin dibuat dari data nyata. | Tambah kolom `current`, `power` (nullable) ke `PackHistory` (migrasi additive), isi saat ingestion, ekspos di endpoint history. | S |
| **F-15** | D/A | FE, BE, deploy | `FE/src/hooks/useBmsSocket.ts:5`; `FE/Dockerfile:1-37` (hanya ARG `BACKEND_URL`); `FE/.env.production.example` (TODO `NEXT_PUBLIC_WS_URL`); `deploy/nginx/bms-adb.conf:31-34`; `BE/docker-compose.yml:18-21` | **[F]** Realtime di produksi hampir pasti mati: `NEXT_PUBLIC_*` di-inline saat *build*, Dockerfile FE tidak menerima build-arg itu, sehingga bundle produksi memakai fallback `ws://localhost:4000/ws`. Nginx tidak punya `location /ws`, port BE tidak dipublish. Komentar di repo sendiri mengakui ini TODO. Juga: (a) reconnect tetap 2 s tanpa backoff/jitter (`:6, :39`), (b) tidak ada re-sync state setelah reconnect (data selama putus hilang), (c) tiap klien menerima data **semua** device lalu difilter di sisi klien (`:10-11`). | Tentukan origin realtime (mis. `wss://host/ws` lewat Nginx `location /ws` → BE), pakai path relatif/derived dari `window.location` atau runtime config, backoff eksponensial+jitter, fetch ulang snapshot saat reconnect, subscribe per device (F-07). | M |
| **F-16** | E | BE, FE | `BE/package.json`; `FE/package.json`; hasil `npm audit` | **[F]** Advisory critical/high pada dependency produksi. BE: `next@15.5.23` (RCE Windows-host & image-optimization AVIF; fix ≥15.5.24), `next-auth@5.0.0-beta.25` + `@auth/core` (fail-open, `getToken()` exception pada header Bearer malformed, PKCE), `nodemailer` (12 advisory; fix di 10.x = breaking), `postcss`, `sharp`. FE: `next@16.3.1` (critical; fix via `npm audit fix`), `swiper` (prototype pollution; dependency **tidak diimpor di mana pun**), `sharp`. Sebagian tidak eksploitabel di setup ini (host Linux, tanpa image optimizer, tanpa OAuth), tetapi tetap harus ditutup. | `npm audit fix` di FE dan BE (Next ke patch terbaru, `next-auth` ≥ beta.32), naikkan `nodemailer` ke rilis tanpa advisory dan uji email reset, **hapus** `swiper`, `react-dnd*` (0 import), aktifkan Dependabot. | S |
| **F-17** | A | root, deploy | `.github/workflows/deploy.yml:1-24` | **[F]** Pipeline: langsung deploy tiap push ke `main` tanpa lint/typecheck/test/build gate; `docker compose down` lalu `up -d --build` **di VPS** = downtime tiap deploy dan, bila build gagal, layanan tetap mati; tanpa `concurrency` (dua push bersamaan saling tabrak); action `appleboy/ssh-action@v1.0.3` dipin ke tag bukan SHA; tidak ada `permissions:` eksplisit; tidak ada `fingerprint` host SSH **[V]**; tidak ada cache build; tidak ada rollback; **migrasi DB tidak pernah dijalankan** oleh pipeline (`git grep "migrate deploy"` kosong) **[V]** bagaimana migrasi produksi dijalankan sekarang. | Job `ci` (tsc, eslint, build, test) sebagai syarat; build image di runner → push ke GHCR; server hanya `docker compose pull && up -d` (tanpa `down`) dengan healthcheck; langkah `prisma migrate deploy` terkontrol; `concurrency`, `permissions: contents: read`, pin SHA. | M |
| **F-18** | D/E | FE | `FE/src/components/bms/BmsSystemMetrics.tsx:21,42,61,78`; `BmsActiveDevicesList.tsx:6-10`; `BmsPowerFlowChart.tsx:47-49`; `BmsVoltageTrendChart.tsx:33-35`; `BmsEnergyDistributionCard.tsx:9`; `components/header/NotificationDropdown.tsx` | **[F]** Halaman utama `/` sepenuhnya hardcode: "3 Units / 100% Online", "84.2%" SoC, "1,240 W", tabel 3 device fiktif (`GAMA-BMS-001..003`), grafik dengan array angka tetap, SoH 88.5. Tidak ada satu pun `api.`/`fetch`/socket di `components/bms/`. Dropdown notifikasi berisi pesan template TailAdmin ("Terry Franci"). Di sistem monitoring baterai, angka palsu tampil sebagai nyata adalah risiko keselamatan/kepercayaan. Catatan: **SoC/SoH tidak ada** di payload maupun skema; angka itu tidak mungkin dihitung dari data sekarang. | Sambungkan ke endpoint ringkasan nyata (lihat bagian 4) atau tandai jelas "DEMO" / sembunyikan sampai siap. Putuskan sumber SoC (firmware vs estimasi kurva tegangan) → pertanyaan Q10. | M |

### 2.3 P2 — Sedang

| ID | Area | Folder | File:baris | Masalah | Rekomendasi | Effort |
|---|---|---|---|---|---|:-:|
| **F-19** | A/B | root, MQTT | `docker-compose.yml:2-3` vs `:11`; `MQTT/docker-compose.yml:8, 11-12`; `MQTT/.gitignore:1`; `BE/docker-compose.yml:3-6` | **[F]** Kontradiksi: komentar root berkata MQTT "sengaja tidak di-include", tetapi `include:` memasukkannya. Jika dijalankan dari root, terbentuk **broker kedua** di host `0.0.0.0:1883` (`ports: "1883:1883"`) sementara BE dikonfigurasi ke broker VPS `bms_mosquitto`. Bind-mount `./config/password_file` tidak ada di repo (yang ter-track `password_file.txt`, F-02) → Docker akan membuat **direktori** kosong dengan nama itu dan Mosquitto gagal start. Tidak ada `acl_file`. `container_name` tetap menghalangi scaling/`-p` project-name. | Putuskan satu sumber kebenaran untuk broker (Q11). Jika broker repo dipakai: hapus `ports` publik/bind ke `127.0.0.1` atau network internal + 8883; buat `password_file` via skrip bootstrap; jika tidak: hapus dari `include:` dan dokumentasikan. | S |
| **F-20** | A | BE | `BE/Dockerfile:16-25` | **[F]** Image runtime BE: berjalan sebagai **root** (tanpa `USER`), `node` sebagai PID 1 tanpa init (SIGTERM cenderung diabaikan → `docker stop` menunggu 10 s lalu SIGKILL), `npm ci` tanpa `--omit=dev` (Prisma CLI, TypeScript, tsx ikut di image), `node:20-alpine` tidak dipin dan **Node 20 sudah EOL sejak April 2026**, `next.config.js` tidak disalin ke runner. Tidak ada `HEALTHCHECK`. | `USER node`, `init: true` (atau `tini`), `npm prune --omit=dev` di stage runner, pin `node:22-alpine@sha256:…`, salin `next.config.js`, `HEALTHCHECK` ke `/api/health`. FE juga: pin base image, runner sudah non-root (bagus). | S |
| **F-21** | C | BE | `BE/src/server.ts:60-64` (tidak ada handler sinyal); tidak ada `/api/health` | **[F]** Tidak ada graceful shutdown: SIGTERM tidak menutup `mqttClient.end()`, `wss.close()`, `server.close()`, `prisma.$disconnect()` → pesan in-flight/transaksi terputus saat deploy. Tidak ada health/readiness endpoint. Default port di kode `3001` (`:10`) berbeda dari dokumentasi/compose (4000); aman hanya bila `PORT` selalu di-set. | Handler `SIGTERM/SIGINT` (stop menerima pesan → drain antrean → tutup), `GET /api/health` (DB ping + status MQTT + umur pesan terakhir), samakan default port. | S |
| **F-22** | C | BE | semua route di `BE/src/app/api/**` (mis. `devices/route.ts:34`, `collaborators/route.ts:40, 51`, `admin/users/[id]/route.ts:52`, `admin/devices/[id]/verify/route.ts:13-18`) | **[F]** Tidak ada `try/catch` ataupun validasi input di satu pun route. `req.json()` invalid → 500; Prisma `P2025` (update id tidak ada) / `P2002` (collaborator duplikat) → 500 tanpa pesan bermakna; `new Date(expiresAt)` invalid → error Prisma; body tidak dibatasi ukuran; format error tidak konsisten (`{error}` string saja, tanpa kode mesin). | Wrapper `route()` yang menangkap error → format error seragam, validasi zod per route, map `P2002→409`, `P2025→404`. | M |
| **F-23** | C/F | BE | `BE/src/app/api/devices/route.ts:10-23` | **[F]** `GET /api/devices` memuat `packs.cells` + semua collaborator + email mereka untuk **setiap** device, tanpa pagination. Boros untuk list di mobile; juga membocorkan email semua collaborator ke setiap viewer. | Varian ringan `?view=summary` / endpoint baru list ringkas; sembunyikan email collaborator dari non-owner. | M |
| **F-24** | C | BE | `BE/src/mqtt/client.ts:14-19` | **[F]** `clientId` acak tiap start dan sesi bersih (`clean` default true) → semua pesan yang dipublish saat BE mati/restart (deploy, F-17) hilang permanen walau QoS 1. Tidak ada LWT/status online-offline: "online" hanya disimpulkan FE dari `updatedAt` < 120 s (`DeviceDetail.tsx:107, 181`). | `clientId` tetap + `clean: false`, atau shared subscription; definisikan topic `bms/{id}/status` (retained, LWT `offline`) dan kolom `Device.lastSeenAt`, `Device.online`. **Kontrak MQTT berubah → mqtt + backend + firmware + docs.** | M |
| **F-25** | B | MQTT | `MQTT/config/mosquitto.conf` (seluruh file), `MQTT/Dockerfile:2` | **[F]** Tidak ada: `acl_file`, `max_connections`, `message_size_limit` (default tak terbatas s.d. 256 MB), `max_queued_messages`, `max_keepalive`, TLS, `log_type` yang dipersempit (memakai `information` = verbose), `healthcheck` compose; `eclipse-mosquitto:2` tidak dipin; izin `password_file` (harus milik uid mosquitto) **[V]**. Topic hanya `bms/{id}/data` (tidak ada `status`, `cmd`, `alert`). | `message_size_limit 16384`, `max_connections`, `per_listener_settings true`, ACL, TLS, pin versi, healthcheck (`mosquitto_sub -t '$SYS/#' -C 1`). | S |
| **F-26** | C | BE | `schema.prisma:48-49, 58-68` | **[F]** FK tanpa indeks: `Device.ownerId` dan `DeviceCollaborator.userId` (query utama `GET /devices` memakai `OR(ownerId, collaborators.some(userId))`); relasi `Cell`/`Pack` memakai `cuid` (36 byte) sebagai PK pada tabel history bervolume tinggi. | `@@index([ownerId])`, `@@index([userId])`; untuk history pertimbangkan PK `BigInt` identity atau tanpa surrogate key (composite). | S |
| **F-27** | C | BE | `api/devices/route.ts:30-52`; `schema.prisma:45-50` | **[F]** Klaim device hanya dengan `serialNumber` (tebakan/pengetahuan serial cukup): siapa cepat dia dapat, termasuk device yang sudah auto-provision dan sudah mengirim data. Flag `verified` tidak pernah dicek di `GET /devices`, `/history`, WS, atau ingestion; hanya kosmetik. Tidak ada endpoint owner untuk rename/unclaim/transfer/hapus device. Role collaborator `editor` (`collaborators/route.ts:55`) tidak memberi hak apa pun (tidak ada endpoint yang membedakan). | Claim code satu kali (dicetak di perangkat/dikirim di provisioning) sebagai bukti kepemilikan; putuskan semantik `verified` (mis. hanya device verified yang boleh menerima data/alert); tambah `PATCH/DELETE /devices/:id`; definisikan hak `editor`. | M |
| **F-28** | E | BE, FE | `BE/src/lib/auth.ts:11`; `BE/src/app/api/auth/forgot-password/route.ts:30`; `FE/next.config.ts:26-37` | **[F]** `trustHost: true` tanpa allow-list host; `APP_URL` tidak divalidasi (bila kosong tautan reset jadi `undefined/reset-password?...`); tidak ada security header (CSP, HSTS, `X-Frame-Options`, `Referrer-Policy`, `X-Content-Type-Options`) di FE, BE, maupun Nginx; token reset dikirim di query string (bocor lewat Referer/log) dan token lama tidak dibatalkan saat token baru dibuat. Tidak ada konfigurasi CORS di BE (aman untuk same-origin sekarang, tapi harus didefinisikan untuk klien lain). | Header di `next.config.ts` (`headers()`) atau Nginx; validasi `APP_URL` saat boot (fail fast); hapus token lama saat membuat baru; `Referrer-Policy: no-referrer` pada halaman reset. | S |
| **F-29** | D | FE | seluruh `FE/src` (lihat §2.5) | **[F]** Bloat TailAdmin: 57 file hanya terjangkau lewat halaman demo (`/calendar`, `/blank`, `/basic-tables`, `/form-elements`, `/alerts`, `/avatars`, `/badge`, `/buttons`, `/images`, `/modals`, `/videos`, `/line-chart`, `/bar-chart`, `/profile`, `/error-404`) + 18 file tak terjangkau (komponen `ecommerce/*`, `videos/*`, dll). Halaman demo tetap ter-*build* dan dapat diakses user login. Dependency hanya untuk demo: `@fullcalendar/*` (6 paket), `@react-jvectormap/*`, `react-dropzone`, `swiper` & `react-dnd*` (0 import); `public/` memuat 115 file, mayoritas aset demo (37 foto user, produk, kartu, dll). `package.json` masih bernama `free-nextjs-admin-dashboard` v2.3.0, `FE/README.md` = README TailAdmin, `LICENSE` template. | Hapus route + komponen + aset + dependency demo (simpan hanya `ui/`, `form/input/*`, `layout/`, `auth/` yang dipakai). Perkiraan: -50% file, bundle lebih kecil, `npm audit` bersih dari `swiper`. | M |
| **F-30** | D | FE | `FE/src/components/devices/DeviceDetail.tsx:165-175`; `DeviceHistoryCharts.tsx`, `PackCard.tsx` | **[F]** Performa realtime: `setInterval(setNow, 1000)` me-render ulang seluruh `DeviceDetail` (443 baris, ikut semua `PackCard` + chart) tiap detik; tidak ada `useMemo`/`React.memo` di `PackCard` maupun `DeviceHistoryCharts`; `applyRealtimeUpdate` membangun ulang seluruh objek tiap pesan; sparkline history hanya dimuat sekali (tidak ikut update realtime). | Pisahkan penghitung "last seen" ke komponen kecil; `memo` pada `PackCard`; append titik ke series dari pesan WS; throttle update chart. | S |
| **F-31** | D/G | FE, BE | `FE/src/types/device.ts` vs `BE/src/types/bms.ts:1-19` vs `schema.prisma` | **[F]** Tipe ditulis manual tiga kali (Prisma, `BmsDevicePayload`, tipe FE) dan sudah menyimpang kecil (mis. `Device.createdAt: string` di FE vs `Date`, `BmsUpdatePayload` menambah `id`/`serialNumber`, tipe history hanya di FE). Tidak ada kontrak bersama/OpenAPI. | Skema zod tunggal → tipe TS + OpenAPI (lihat §4). | M |
| **F-32** | G | FE, BE | `FE` eslint; `BE/package.json:lint`; tidak ada file `*.test.*`/`*.spec.*` | **[F]** 10 error ESLint FE (`react-hooks/set-state-in-effect` di `ThemeContext.tsx:26`, `useAnimatedNumber.ts:21`, `AppSidebar.tsx:286`, `DeviceApproval.tsx:48`, `UserManagement.tsx:52,62`; sisanya kode demo). BE punya script `lint` tetapi tanpa config → tidak jalan. **0 test** di seluruh repo. | ESLint flat config di BE; perbaiki 3-5 error nyata; Vitest untuk BE. Prioritas test: lihat §G di bawah. | M |
| **F-33** | D | FE | `FE/Dockerfile:5-9` | **[F]** `package-lock.json` sengaja tidak disalin dan `npm install --legacy-peer-deps` → build tidak reproduktif (versi berubah tiap build; audit lokal ≠ audit image). Alasannya (lockfile darwin-arm64) bisa diselesaikan dengan `npm ci` setelah `npm install --package-lock-only --os=linux --cpu=x64`/menghapus dep optional platform-spesifik. | Commit lockfile lintas platform dan pakai `npm ci`. | S |
| **F-34** | H | semua | `README.md` (dan tidak ada README di `BE/`, `MQTT/`, `IoT/`); `FE/README.md` | **[F]** Dokumentasi basi/salah: "GAMA BMS 16 (App Router)", "GAMA BMS Route Handlers" (hasil find-replace "Next.js" → "GAMA BMS"); TODO "belum ada tabel history" padahal sudah ada; tidak ada dokumen kontrak payload MQTT (padahal README mewajibkan update dokumentasi firmware saat berubah); tidak ada panduan deploy selain komentar di compose/Nginx; `.env.example` tidak memuat `NEXT_PUBLIC_WS_URL` di produksi, `RESEND_API_KEY` yatim, `MQTT_USERNAME/PASSWORD` dikomentari padahal broker wajib auth. | Buat `docs/MQTT-CONTRACT.md`, `docs/DEPLOY.md`, `docs/API.md` (dari OpenAPI), README per folder; rapikan `.env.example`. | M |

### 2.4 P3 — Rendah

| ID | Area | Folder | File:baris | Masalah | Rekomendasi | Effort |
|---|---|---|---|---|---|:-:|
| **F-35** | E | BE | `admin/users/[id]/route.ts:35-80` | **[F]** Admin bisa menurunkan/menghapus dirinya sendiri atau admin terakhir (lockout); `DELETE user` tidak menghapus sesi aktif (F-08). | Larang self-demote/self-delete, minimal 1 admin. | S |
| **F-36** | D | FE | `FE/src/layout/AppSidebar.tsx:320`; `globals.css:3` | **[F]** Sidebar dipaksa gelap lewat class `dark` di `<aside>`. Dengan `@custom-variant dark (&:is(.dark *))`, varian `dark:` hanya cocok untuk *turunan* elemen bertanda `.dark`, bukan elemen itu sendiri → utilitas `dark:*` pada `<aside>` tidak berlaku (kelas gelap ditulis manual: `bg-gray-900` dst.); portal/dropdown yang dirender di luar `<aside>` tidak ikut gelap. Bekerja, tapi rapuh terhadap perubahan. Tema default "light" tanpa `prefers-color-scheme` (`ThemeContext.tsx:24`). | Ganti dengan token tema sidebar (`--sidebar-*`) agar tidak bergantung pada trik kelas. | S |
| **F-37** | D | FE | seluruh `FE/src` | **[F]** Aksesibilitas dasar minim: hanya 2 pemakaian `aria-*`; modal/dropdown custom tanpa focus trap **[V]**; peringatan lewat SweetAlert2 (bundle besar untuk 3 fungsi); 15 `console.log` tersisa. Tidak ada state empty/error yang terkoneksi ke retry di `DeviceList` (hanya pesan). | Audit dengan axe/Lighthouse; ganti `sweetalert2` dengan modal internal; tombol "coba lagi". | M |
| **F-38** | A | root | `.claude/launch.json`; `IoT/__pycache__/` | **[F]** Konfigurasi lokal user (path absolut `/Users/…`) dan bytecode ter-track. `.gitignore` root tidak memuat `__pycache__/`, `*.pyc`, `cookies*.txt`, `.claude/`. | Perluas `.gitignore`, `git rm --cached`. | S |
| **F-39** | D/A | FE | `FE/src/proxy.ts:35-37`; `FE/next.config.ts:26-37` | **[F]** Proxy Next 16 (pengganti middleware) hanya melindungi halaman; `/api/*` dikecualikan dan diteruskan ke BE (benar), tetapi seluruh otorisasi bergantung pada BE (F-08/F-10). Rewrites dievaluasi saat build (`FE/Dockerfile` komentar) → mengganti `BACKEND_URL` butuh rebuild image. | Cukup dicatat di dokumentasi deploy. | S |

### 2.5 Yang sudah baik (dipertahankan)

- Password `bcrypt` cost 12; `PasswordResetToken` disimpan sebagai SHA-256, sekali pakai, kedaluwarsa 1 jam; respons `forgot-password` generik.
- Ownership/collaborator check benar pada `GET /devices/:id` dan `/history`; `onDelete: Cascade` pada relasi.
- Prisma client singleton; `getValidSession` menangani JWT yatim (user dihapus).
- FE runner non-root + `output: "standalone"`; port FE di-bind ke `127.0.0.1`; `.dockerignore` mengecualikan `.env*`.
- `tsc --noEmit` bersih, `strict: true` di kedua proyek.
- Payload sudah membawa arus (negatif = charging) dan daya; skema Device→Pack→Cell dinamis sudah cocok dengan domain.

---

## 3. Inventaris Endpoint

`Auth` = mekanisme yang dipakai sekarang. **Mobile-ready?** ✅ pakai apa adanya · ⚠️ perlu diubah · ❌ tidak cocok / belum ada. Semua route berada di `BE` dan diakses FE lewat rewrite `/api/backend/*` → BE `/api/*` (dan `/api/auth/*` → BE `/api/auth/*`).

### 3.1 REST

| # | Method | Path | Auth | Request → Response (ringkas) | File | Mobile-ready? | Catatan |
|--:|---|---|---|---|---|:-:|---|
| 1 | GET, POST | `/api/auth/[...nextauth]` (`session`, `csrf`, `callback/credentials`, `signout`, `providers`) | Auth.js cookie | Alur CSRF + cookie `authjs.session-token` | `api/auth/[...nextauth]/route.ts` | ❌ | Perlu endpoint token terpisah (§4.1) |
| 2 | POST | `/api/auth/register` | Publik | `{name?,email,password≥8}` → `201 {id,email,name}` / 400 / 409 | `api/auth/register/route.ts` | ⚠️ | Tanpa rate limit/verifikasi email; 409 membocorkan email |
| 3 | POST | `/api/auth/forgot-password` | Publik | `{email}` → `200 {message}` | `api/auth/forgot-password/route.ts` | ⚠️ | Tautan web (`APP_URL`); mobile butuh deep link; tanpa rate limit |
| 4 | POST | `/api/auth/reset-password` | Publik (token) | `{token,newPassword}` → `200 {message}` / 400 | `api/auth/reset-password/route.ts` | ⚠️ | Tidak mencabut sesi lain |
| 5 | GET | `/api/devices` | Cookie | → `Device[]` (+packs+cells+collaborators) | `api/devices/route.ts` | ⚠️ | Terlalu berat; tanpa pagination/filter |
| 6 | POST | `/api/devices` | Cookie | `{serialNumber,name?}` → `201/200 Device` / 409 | `api/devices/route.ts` | ⚠️ | Klaim tanpa bukti; tanpa validasi |
| 7 | GET | `/api/devices/:id` | Cookie + owner/collab | → `Device` (+owner,packs,cells,collaborators) | `api/devices/[id]/route.ts` | ✅ (setelah auth token) | Bentuk data cocok; tambahkan `lastSeenAt/online`, ISO waktu |
| 8 | GET | `/api/devices/:id/history?hours=` | Cookie + owner/collab | → `{from,to,hours,packs[{temperature[],cells[]}]}` | `api/devices/[id]/history/route.ts` | ❌ | Tanpa limit/downsample/cursor; tanpa current/power |
| 9 | GET | `/api/devices/:id/collaborators` | Cookie **saja** | → `Collaborator[]` | `api/devices/[id]/collaborators/route.ts` | ❌ | **IDOR (F-10)** |
| 10 | POST | `/api/devices/:id/collaborators` | Cookie + owner | `{email,role}` → `201 Collaborator` / 404 / 400 | idem | ⚠️ | Duplikat → 500; enumerasi email |
| 11 | DELETE | `/api/devices/:id/collaborators?userId=` | Cookie + owner | → `200 {message}` | idem | ✅ | Ok setelah auth token; lebih RESTful: `/collaborators/:userId` |
| 12 | GET | `/api/admin/users` | Cookie + ADMIN (dari JWT) | → `User[]` | `api/admin/users/route.ts` | n/a | Admin web saja; tanpa pagination |
| 13 | POST | `/api/admin/users` | idem | `{name,email,password,role,expiresAt}` → `201` | idem | n/a | |
| 14 | GET, PATCH, DELETE | `/api/admin/users/:id` | idem | detail / ubah / hapus (409 bila punya device) | `api/admin/users/[id]/route.ts` | n/a | Self-demote/delete (F-35) |
| 15 | GET | `/api/admin/devices?verified=` | idem | → `Device[]`(+owner) | `api/admin/devices/route.ts` | n/a | Tanpa pagination |
| 16 | DELETE | `/api/admin/devices/:id` | idem | → `200` / 404 | `api/admin/devices/[id]/route.ts` | n/a | |
| 17 | PATCH | `/api/admin/devices/:id/verify` | idem | `{verified}` → `Device` | `api/admin/devices/[id]/verify/route.ts` | n/a | 500 bila id tidak ada |

**Tidak ada:** `/api/health`, versioning (`/v1`), pagination, OpenAPI, endpoint profil (`/me`), ubah password, alert, device token push, dashboard summary, PATCH/DELETE device oleh owner.

### 3.2 WebSocket & MQTT

| Kanal | Arah | Auth | Payload | File | Mobile-ready? |
|---|---|---|---|---|:-:|
| `WS /ws` | server→klien, event `bms:update`, envelope `{event,payload,ts:Date.now()}` | **Tidak ada** | `{id,serialNumber,timestamp(ms),packs[{index,temperature,balancerConnected,current?,power?,cells[{index,voltage}]}]}` untuk **semua** device | `server.ts:33-58`, `lib/ws.ts` | ❌ (F-07) |
| MQTT `bms/{device_id}/data` (QoS 1) | ESP32 → broker → BE (subscribe `bms/+/data`) | user+password bersama, tanpa ACL | sama seperti payload di atas (tanpa `id/serialNumber`) | `mqtt/client.ts:23` | n/a (kontrak firmware) |

**Konsistensi format waktu (fakta):** MQTT & WS memakai `timestamp` unix **milidetik** (angka) dan `ts` unix ms; REST memakai ISO-8601 (serialisasi `Date`). Mobile sebaiknya hanya melihat satu bentuk (ISO-8601 UTC).

---

## 4. Gap Analysis Kesiapan Mobile (Area F)

### 4.1 Auth: opsi dan rekomendasi

Kondisi sekarang **[F]**: Auth.js v5 Credentials + JWT (JWE) di cookie `authjs.session-token` (HttpOnly, host-only, tanpa flag `Secure` karena HTTP), FE rewrite same-origin supaya cookie ikut. Tidak ada refresh, tidak ada revoke, `maxAge` default 30 hari, role/expiry dibaca dari JWT (F-08). Klien native tidak punya cookie jar yang ramah, tidak ada CSRF flow yang masuk akal, dan tidak boleh membawa kredensial berumur 30 hari tanpa revoke.

| Opsi | Uraian | Kelebihan | Kekurangan |
|---|---|---|---|
| **A (rekomendasi)** | Endpoint token sendiri di BE: `POST /api/v1/auth/login` → `{accessToken (JWT, ±15 mnt), refreshToken (opaque acak 256-bit), expiresIn}`; `POST /api/v1/auth/refresh` (rotasi: refresh lama langsung hangus, deteksi *reuse* → cabut seluruh *token family*); `POST /api/v1/auth/logout` (cabut refresh token); `POST /api/v1/auth/logout-all`. Tabel `RefreshToken(id, userId, familyId, tokenHash, deviceName, platform, createdAt, lastUsedAt, expiresAt, revokedAt, replacedById)`. | Kontrol penuh, revoke nyata, bisa mengecek role/expiry dari DB tiap refresh, tidak menyentuh Auth.js web | Kode tambahan (±300 baris), perlu uji keamanan |
| B | Pakai JWT Auth.js apa adanya lewat header `Authorization: Bearer` (`getToken` mendukung Bearer) | Kode paling sedikit | Umur 30 hari tanpa revoke/rotasi; JWE terikat secret bersama; advisory `getToken()` pada Bearer malformed (perlu ≥ beta.32) |
| C | Ganti ke IdP (Keycloak/Ory/Better-Auth/Supabase Auth) | Fitur lengkap (MFA, social) | Migrasi user & FE besar; overkill untuk capstone |

**Koeksistensi dengan web tanpa merusaknya (Opsi A):**
1. Tambahkan `getPrincipal(req)` di `lib/authz.ts`: bila ada `Authorization: Bearer` → verifikasi access-token (`jose`, `HS256/EdDSA`, secret `JWT_ACCESS_SECRET` **berbeda** dari `NEXTAUTH_SECRET`); jika tidak → `auth()` seperti sekarang. `requireAuth`/`requireAdmin` memanggil `getPrincipal`, sehingga semua route otomatis mendukung dua jenis klien.
2. Verifikasi kredensial dipakai bersama (`verifyPassword(email, password)` di-refactor dari `authorize`) supaya aturan expiry/lockout sama.
3. Access-token berisi `sub`, `role`, `ver` (versi token pengguna); `getPrincipal` menolak bila `ver` di DB berbeda → satu mekanisme untuk "cabut semua sesi" (ganti password) bagi web maupun mobile; tambahkan `tokenVersion` ke `User` dan cek juga di `getValidSession`.
4. Penyimpanan di device: iOS Keychain / Android Keystore (`expo-secure-store` / `flutter_secure_storage`); access-token hanya di memori; refresh-token di secure storage; **jangan** simpan di AsyncStorage/SharedPreferences biasa. Biometrik opsional untuk membuka refresh-token.
5. Ganti password / reset → `tokenVersion++` + cabut semua refresh token. Reset password untuk mobile perlu *universal link / app link* (`https://host/reset-password?token=…` yang dibuka aplikasi).
6. Logout: hapus token lokal + `POST /logout` (cabut server-side) + hapus device token push milik sesi itu.

### 4.2 Daftar perubahan backend — WAJIB vs OPSIONAL, urutan pengerjaan

**Fase 0 — Prasyarat (sebelum menulis satu baris pun kode mobile)**
| # | Item | Wajib? | Folder | Terkait |
|--:|---|:-:|---|---|
| 0.1 | Rotasi semua secret, bersihkan riwayat git | Wajib | semua | F-01…F-04 |
| 0.2 | TLS + domain, ekspos BE lewat Nginx (`/api/v1/`, `/ws`) atau subdomain `api.` | Wajib | deploy, BE | F-06, F-15 |
| 0.3 | Patch dependency (Next, next-auth, nodemailer) | Wajib | BE, FE | F-16 |

**Fase 1 — Fondasi API v1**
| # | Item | Wajib? | Folder | Kontrak |
|--:|---|:-:|---|---|
| 1.1 | Skema zod tunggal untuk request/response + generator OpenAPI (§4.3) | Wajib | BE (+docs, FE, mobile) | ✔ API |
| 1.2 | Namespace `/api/v1/*`, format error seragam, `requestId` | Wajib | BE, docs | ✔ API |
| 1.3 | Auth token (login/refresh/logout) + `getPrincipal` + `tokenVersion` | Wajib | BE, docs, mobile | ✔ API |
| 1.4 | Rate limiting (login/refresh/register/forgot; per IP & akun; 429 + `Retry-After`) | Wajib | BE, deploy | ✔ API |
| 1.5 | `GET /api/v1/health` + `GET /api/v1/version` (min app version → 426) | Wajib | BE | ✔ API |
| 1.6 | Perbaiki IDOR (F-10), helper otorisasi tunggal | Wajib | BE | |
| 1.7 | Validasi payload MQTT + antrean ingestion + idempotensi (F-11, F-12) | Wajib | BE, docs | ✔ MQTT |

**Fase 2 — Data untuk layar mobile**
| # | Item | Wajib? | Folder | Kontrak |
|--:|---|:-:|---|---|
| 2.1 | `GET /v1/me` (profil, role, expiry) | Wajib | BE | ✔ API |
| 2.2 | `GET /v1/devices?cursor=&limit=&view=summary` → `{id,serialNumber,name,verified,role(owner/viewer/editor),online,lastSeenAt,packCount,summary{packVoltage,current,power,tempMax,cellDeltaMv,charging}}` | Wajib | BE | ✔ API |
| 2.3 | `GET /v1/devices/:id` (snapshot lengkap + `lastSeenAt/online`) | Wajib | BE | ✔ API |
| 2.4 | `GET /v1/devices/:id/history?from&to&bucket=raw|1m|5m|1h&metrics=voltage,temp,current,power&packIndex=` (agregasi SQL, batas titik, cursor untuk raw) + kolom `current/power` di history (F-13, F-14) | Wajib | BE, docs | ✔ API + migrasi |
| 2.5 | `GET /v1/dashboard/summary` (jumlah device online/offline, total daya, alert aktif) | Wajib (untuk beranda) | BE | ✔ API |
| 2.6 | Manajemen collaborator: `GET/POST/PATCH/DELETE /v1/devices/:id/collaborators[/:userId]`, `PATCH/DELETE /v1/devices/:id` (rename, unclaim) | Wajib | BE | ✔ API |
| 2.7 | `Device.lastSeenAt`, `online`, topic `bms/{id}/status` (LWT retained) | Wajib | mqtt, BE, firmware, docs | ✔ MQTT |

**Fase 3 — Realtime & notifikasi**
| # | Item | Wajib? | Folder | Kontrak |
|--:|---|:-:|---|---|
| 3.1 | WS terautentikasi + `subscribe` per device + heartbeat + resume (§4.4) | Wajib bila live view di mobile | BE, FE, mobile | ✔ WS |
| 3.2 | Modul alert: `AlertRule`, `AlertEvent` + evaluasi di ingestion + `GET /v1/alerts?cursor&status`, `POST /v1/alerts/:id/ack` (§4.5) | Wajib bila mobile menampilkan alert | BE, docs | ✔ API |
| 3.3 | `POST/DELETE /v1/push/devices` (registrasi/hapus device token) + pengirim push (FCM / Expo) | Wajib bila ada push | BE, mobile | ✔ API |
| 3.4 | Preferensi notifikasi per user/device (`quietHours`, tingkat severity) | Opsional | BE, mobile | ✔ API |

**Fase 4 — Opsional / penyempurnaan**
Kompresi (Nginx `gzip`/`brotli`), `ETag`/`If-None-Match` + `Cache-Control` pada snapshot & history, retensi + rollup terjadwal (F-13), OpenAPI SDK terbit otomatis, log audit, `PATCH` parsial konsisten, `idempotency-key` untuk POST, rate limit adaptif per token.

### 4.3 Kontrak API: OpenAPI + tipe bersama

**Kondisi [F]:** tidak ada OpenAPI/Swagger, tidak ada paket tipe bersama; FE menulis ulang tipe manual (F-31).

**Usulan:** *satu sumber kebenaran* = skema **zod** di `BE/src/contracts/*.ts`:
1. Tiap route mem-parse request dengan skema yang sama dan mendeklarasikan response-nya (`zod-to-openapi` atau `@asteasolutions/zod-to-openapi`; alternatif `next-openapi-gen`). Skrip `npm run openapi` menghasilkan `docs/openapi.json` (CI gagal bila berubah tanpa commit).
2. Klien: web & mobile menghasilkan tipe dan klien dengan `openapi-typescript` + `openapi-fetch` (atau `orval` untuk hooks React Query). Bila mobile bukan TypeScript (Flutter/Kotlin/Swift): `openapi-generator` per bahasa.
3. Payload MQTT ikut skema zod yang sama (`BmsDevicePayloadSchema`) → dipakai untuk validasi runtime **dan** dokumentasi `docs/MQTT-CONTRACT.md` (di-generate ke JSON Schema untuk tim firmware).
4. Catatan trade-off: `BE/Dockerfile` membangun dengan konteks folder `BE/` saja, jadi paket bersama antar-folder membutuhkan perubahan konteks build ke root (workspace) atau cukup **meng-commit `openapi.json` dan tipe hasil generate** ke FE. Yang kedua lebih murah untuk capstone.
5. Swagger UI/Redoc di `/api/docs` hanya untuk non-produksi atau dilindungi admin.

### 4.4 Realtime untuk mobile

| Opsi | Baterai/data | Background | Reconnect | Cocok untuk |
|---|---|---|---|---|
| **WebSocket** (yang sudah ada) | Baik saat foreground bila ada ping ~25-30 s dan hanya subscribe device yang dilihat | OS mematikan soket saat app background → tidak bisa diandalkan | Wajib backoff+jitter, `resume?since=` atau re-fetch snapshot | Layar "live" detail device |
| **SSE** | Setara WS, satu arah, lebih sederhana lewat proxy/HTTP2 | Sama; iOS menghentikan saat background | Bawaan (`Last-Event-ID`) | Alternatif bila cukup satu arah; butuh streaming di Route Handler custom |
| **Polling** (interval 15-60 s + ETag) | Boros baterai bila cepat, sederhana | Tidak jalan di background | Trivial | Daftar device / dashboard |
| **Push** (FCM/APNs) | Paling hemat | **Satu-satunya** yang menjangkau app tertutup | n/a | Alert kritis |

**Rekomendasi:** WS terautentikasi (subscribe per device, ping/pong, resume) **hanya saat layar live terbuka (foreground)**; berhenti saat `AppState=background`; daftar/dashboard memakai REST + polling ringan (ETag); alert memakai **push**, bukan WS. Server: batasi frekuensi push realtime per koneksi (mis. maks 1 pesan/detik/device), kirim *delta* atau hanya field yang berubah, dan pertimbangkan Redis pub/sub bila BE dijalankan >1 instance (sekarang `broadcast` hanya in-process).

### 4.5 Push notification & modul alert

**Fakta [F]:** tidak ada modul alert di BE (satu-satunya notifikasi = email reset password); dropdown notifikasi FE hanya template.

- **Model data:**
  - `DeviceToken(id, userId, platform ['ios'|'android'], provider ['fcm'|'apns'|'expo'], token UNIQUE, appVersion, locale, createdAt, lastSeenAt, revokedAt)`; satu user banyak token; token dihapus saat logout & saat provider mengembalikan "unregistered".
  - `AlertRule(id, deviceId, metric [cellVoltage, cellDelta, packTemp, current, power, offline], op, threshold, severity, durationSec, cooldownSec, enabled)` dengan default bawaan LiFePO4 (mis. cell < 2.5 V / > 3.65 V, suhu > 55 °C, delta sel > 100 mV, offline > 3× interval).
  - `AlertEvent(id, deviceId, packIndex?, cellIndex?, ruleId/type, severity, value, firedAt, resolvedAt?, ackedBy?, ackedAt?, dedupeKey)`.
  - `NotificationLog(id, alertEventId, userId, deviceTokenId, sentAt, status, error)`.
- **Kapan dikirim:** mesin state per `dedupeKey (deviceId,type,pack,cell)`: `OK → FIRING` setelah kondisi bertahan ≥ `durationSec` (hindari lonjakan sesaat), kirim **sekali**, lalu `cooldown` (mis. 15 menit) sebelum boleh diulang / eskalasi; kirim notifikasi "pulih" saat `RESOLVED` dengan histeresis (mis. batas pulih lebih longgar 2 %). Offline dideteksi oleh job periodik (interval publisher 60 s → offline bila tidak ada data 3 menit) atau LWT.
- **Penerima:** owner + collaborator (role sesuai preferensi), tanpa duplikasi antar-device token yang sama.
- **Dampak ke backend:** evaluasi dilakukan **di jalur ingestion setelah validasi** (memerlukan F-11/F-12 dulu), pengiriman lewat antrean terpisah agar kegagalan FCM tidak memblokir penulisan DB; retry + backoff; batasi rate per user; pertimbangkan pindahkan email reset ke antrean yang sama (F-09). **Kontrak API baru + tabel baru → backend + docs + mobile; tidak mengubah kontrak MQTT** (kecuali topic `status`, F-24).
- **Provider:** Expo Push bila mobile React Native/Expo (paling cepat); FCM langsung bila Flutter/native (dan APNs lewat FCM). Keputusan di Q4.

### 4.6 Hal teknis lain

| Topik | Kondisi sekarang [F] | Rekomendasi |
|---|---|---|
| Format waktu | Campuran unix ms (MQTT/WS) dan ISO (REST) | API v1: selalu ISO-8601 UTC (`2026-09-21T08:15:00.000Z`); tambahkan `receivedAt`; jangan kirim timestamp lokal |
| Satuan | Hanya komentar di tipe (`V`, `A` negatif=charging, `W`, `°C`) | Dokumentasikan di OpenAPI/`MQTT-CONTRACT.md`; tetapkan tanda arus dan presisi (mis. 3 desimal V) satu kali |
| Ukuran payload | `GET /devices` memuat semua cell; history bisa jutaan titik | Summary view, `limit` maks, downsampling, field selection (`fields=`), gzip |
| Pagination | Tidak ada | Cursor `(createdAt,id)` opaque untuk list; `(recordedAt)` untuk raw history; `nextCursor` di response |
| Kompresi | Tidak dikonfigurasi di Nginx | `gzip on; gzip_types application/json;` (atau brotli) |
| Versioning | Tidak ada | `/api/v1`; header `X-App-Version` + endpoint `/v1/version` → 426 untuk klien terlalu lama; kebijakan deprecation |
| Kode error | `{error: "kalimat bebas"}` | `{error:{code:"DEVICE_NOT_FOUND", message, details?}, requestId}`; daftar kode stabil; status HTTP benar (401 vs 403 vs 404 untuk non-collab agar tidak bocor eksistensi) |
| Rate limit | Tidak ada | Per IP & per user; header `RateLimit-*` + `Retry-After` |
| CORS / origin | Tidak ada konfigurasi (same-origin lewat rewrite) | App native tidak butuh CORS; untuk Expo Web/dev tetapkan allow-list eksplisit; jangan `*` bila memakai cookie |
| Offline/cache | — | `ETag`/`If-None-Match`, field `updatedAt` per resource, klien menyimpan snapshot terakhir dan menandai "data lama (n menit)"; antrean aksi ringan (rename, ack alert) dengan `Idempotency-Key` |
| Jaringan | BE tidak terekspos publik | Ekspos hanya `/api/v1/*` & `/ws` di Nginx; `/api/auth/*` (Auth.js) tetap hanya untuk web; TLS + HSTS |

---

## 5. Quick Wins (masing-masing < 1 jam)

1. **Rotasi secret** F-01/F-02/F-03/F-04 (cabut Gmail App Password, ganti password MQTT & DB, generate `NEXTAUTH_SECRET` baru). *(Rotasi = <1 jam; pembersihan riwayat = F-04.)*
2. `git rm --cached` `cookies*.txt`, `MQTT/config/password_file.txt`, `IoT/__pycache__`, `.claude/launch.json`; perluas `.gitignore` root; ganti isi `BE/.env.example` dengan placeholder.
3. Perbaiki IDOR `GET …/collaborators` (F-10): pakai pengecekan owner/collaborator yang sama dengan `GET /devices/:id`.
4. `getValidSession`: `select { id, role, expiresAt }` dan tolak bila expired; ambil role dari DB untuk `requireAdmin` (F-08).
5. `npm audit fix` di FE dan BE; hapus dependency `swiper`, `react-dnd`, `react-dnd-html5-backend` (0 import) (F-16, F-29).
6. Tambah indeks `Device.ownerId`, `DeviceCollaborator.userId`, `PackHistory(deviceId, recordedAt)`, `CellHistory(deviceId, recordedAt)` dalam satu migrasi additive (F-13, F-26).
7. Tambah `GET /api/health` dan `HEALTHCHECK`/`healthcheck:` di compose (F-20, F-21).
8. `BE/Dockerfile`: `USER node`, `npm prune --omit=dev`, compose `init: true`; handler `SIGTERM` (F-20, F-21).
9. `deploy.yml`: `permissions: { contents: read }`, `concurrency`, pin `appleboy/ssh-action` ke SHA, ganti `down && up --build` menjadi `up -d --build` (F-17) — solusi penuh (CI + registry) tetap M.
10. Sembunyikan/tandai "DEMO" dashboard `/` sampai terhubung data nyata (F-18).
11. Skema zod minimal untuk payload MQTT + drop pesan invalid + counter (F-11).
12. Perbaiki `MQTT/.gitignore` ↔ mount compose, dan komentar `include:` di root compose (F-19).
13. Nginx: `map $http_upgrade $connection_upgrade`, `limit_req` untuk `/api/auth`, security header dasar, `location /ws` (F-06, F-15).
14. Lengkapi `.env.example` (nama variabel + komentar wajib) dan hapus `RESEND_API_KEY` yatim; tambahkan `docs/MQTT-CONTRACT.md` versi singkat dari `BE/src/types/bms.ts`.
15. Tambahkan `eslint.config.mjs` di BE agar `npm run lint` berjalan non-interaktif.

---

## 6. Roadmap Perbaikan (prioritas P0/P1 dulu)

Tanda **⇄** = menyentuh lebih dari satu folder / kontrak. **📜** = mengubah kontrak MQTT/API (backend + docs (+ mobile)).

### Sprint 0 — Tutup kebocoran (hari 1-2)
| Item | Folder | Catatan |
|---|---|---|
| ⇄ Rotasi & pembersihan riwayat (F-01…F-04) | IoT, MQTT, BE, root, deploy (env VPS) | Semua environment: VPS `.env.production`, broker, Gmail, DB |
| Patch dependency (F-16) | BE, FE | `npm audit fix`, hapus dep mati |
| Sanitasi `.gitignore`, `.env.example` | root, BE, FE | Quick wins 2, 14 |

### Sprint 1 — Keamanan & fondasi produksi (minggu 1)
**MQTT**
- ⇄📜 ACL + user per device + user backend read-only, batas pesan/koneksi, pin versi (F-05, F-25) — *mqtt + BE + IoT/firmware + docs*
- ⇄ TLS 8883 (F-06)
- Perbaiki mount `password_file`/kebijakan broker tunggal (F-19)

**BE**
- Otorisasi: IDOR, helper tunggal, role/expiry dari DB, `tokenVersion` (F-08, F-10)
- Rate limiting + anti-abuse email (F-09)
- Wrapper route + zod + error seragam (F-22)
- Health + graceful shutdown (F-21), Dockerfile non-root (F-20)

**Deploy / infra (root, FE, BE)**
- ⇄ TLS + domain + Nginx (`/ws`, `/api/v1`, header, rate limit) (F-06, F-15, F-28)
- ⇄ CI (tsc/eslint/build/test) + build ke GHCR + deploy tanpa `down` + `migrate deploy` (F-17)

### Sprint 2 — Pipeline data yang benar (minggu 2-3)
**BE**
- ⇄📜 Validasi payload + antrean + batch + idempotensi + `receivedAt` (F-11, F-12) — *BE + docs + firmware (semantik timestamp)*
- ⇄📜 History: kolom `current/power`, endpoint downsample/cursor, indeks, retensi (F-13, F-14) — *BE + FE (`DeviceHistoryCharts`) + docs*
- ⇄📜 `lastSeenAt/online` + topic `status`/LWT (F-24) — *mqtt + BE + firmware + FE*

**FE**
- ⇄ Perbaiki realtime produksi (F-15) — *FE + deploy + BE*
- Hapus bloat TailAdmin (F-29), perbaiki lint (F-32), `memo`/timer (F-30), lockfile (F-33)
- Sambungkan dashboard beranda ke data nyata atau hapus (F-18)

### Sprint 3 — Kontrak & API v1 untuk mobile (minggu 3-5)
- ⇄📜 zod → OpenAPI, `/api/v1`, generator klien, tipe bersama (F-31) — *BE + FE + docs + mobile*
- ⇄📜 Token auth (login/refresh/logout, `RefreshToken`) (§4.1) — *BE + docs + mobile (+ FE tidak berubah)*
- ⇄📜 Endpoint mobile: `/me`, `devices` (summary+cursor), `dashboard/summary`, manajemen collaborator/device (§4.2 fase 2) — *BE + docs + mobile*
- ⇄📜 WS terautentikasi + subscribe (F-07) — *BE + FE + mobile + docs*
- Claim code & semantik `verified` (F-27)

### Sprint 4 — Alert & push
- ⇄📜 Modul alert + `DeviceToken` + pengirim push (§4.5) — *BE + docs + mobile + FE (dropdown notifikasi nyata)*
- Preferensi notifikasi, riwayat alert, ack

### Kualitas berkelanjutan (paralel)
Tes prioritas (urutan paling bernilai): (1) parser/validator payload MQTT; (2) `persistPayload` (integrasi dengan Postgres test container: idempotensi, out-of-order, first-message race); (3) otorisasi (`assertCanView/Owner`, matrix owner/collab/asing/admin/expired); (4) history query (bucket & batas); (5) mesin alert (histeresis/cooldown); (6) auth token (rotasi & reuse detection). FE: uji komponen `applyRealtimeUpdate`, e2e Playwright untuk login → daftar device → detail. Terapkan Vitest + Testcontainers; target CI wajib hijau sebelum deploy.

---

## 7. Pertanyaan Keputusan Arsitektur

Tolong jawab sebelum ada yang di-coding. Tiap pertanyaan memuat opsi, rekomendasi saya, dan trade-off singkat.

**Q1. Repo GitHub `MozesJr/Modular-BMS-ADB-UGM` publik/pernah publik, dan apakah nilai di `BE/.env.example` masih dipakai di VPS?**
- (a) Rotasi + `git filter-repo` + force-push *(rekomendasi bila ada risiko publik)*. Trade-off: semua kontributor harus re-clone, fork lama tetap membawa riwayat.
- (b) Rotasi saja, biarkan riwayat. Trade-off: cepat, tapi nilai lama tetap terbaca di riwayat (aman **hanya** jika sudah pasti semuanya sudah tidak berlaku dan repo privat).
- Info yang saya butuhkan: apakah `NEXTAUTH_SECRET` dev = produksi, dan password MQTT/DB/Gmail dipakai ulang di tempat lain?

**Q2. Strategi autentikasi mobile?**
- (a) Endpoint token sendiri, access ±15 mnt + refresh rotasi, hidup berdampingan dengan Auth.js *(rekomendasi)*. Trade-off: ±300 baris + tabel baru; kontrol & revoke penuh.
- (b) Bearer memakai JWT Auth.js. Trade-off: tercepat, tapi 30 hari tanpa revoke.
- (c) Pindah ke IdP eksternal. Trade-off: fitur kaya, migrasi mahal.

**Q3. Realtime di mobile?**
- (a) WS foreground + push untuk alert + REST/ETag untuk list *(rekomendasi)*; (b) SSE; (c) polling saja. Trade-off: (a) satu protokol yang sudah ada tapi butuh authz per device; (b) lebih sederhana tapi satu arah & belum ada di stack; (c) paling sederhana tapi boros baterai/server dan tidak ada "live".

**Q4. Stack mobile & provider push?**
- React Native/Expo → Expo Push *(paling cepat)*; Flutter/native → FCM langsung (APNs via FCM). Saya perlu tahu stack mobile untuk memilih generator klien OpenAPI dan skema `DeviceToken.provider`.

**Q5. Model autentikasi MQTT & klaim device?**
- (a) User MQTT per device (= serial) + `acl_file` + TLS *(rekomendasi)*: isolasi penuh, tapi provisioning ESP32 lebih rumit (kredensial per unit, simpan di NVS).
- (b) Satu user bersama + ACL berdasar prefiks: mudah, tetapi kebocoran satu unit membuka semua.
- (c) Dynamic Security plugin Mosquitto: kelola user via API, kompleksitas lebih tinggi.
- Sekalian: apakah klaim device wajib memakai *claim code* sekali pakai (rekomendasi: ya)?

**Q6. Penyimpanan time-series & retensi?**
- (a) Postgres biasa + indeks + job retensi + tabel rollup *(rekomendasi awal, tanpa dependency baru)*; (b) partisi bulanan; (c) TimescaleDB (kompresi + continuous aggregates) **jika** `master_postgresql` mengizinkan extension. Trade-off: (c) terbaik untuk skala besar, tapi mengikat ke DB bersama yang tidak Anda kelola penuh.
- Perlu keputusan: retensi raw (usul 30 hari), rollup 1 menit (1 tahun?), dan apakah `current/power` wajib masuk history (rekomendasi: ya).

**Q7. Arsitektur ingestion?**
- (a) Tetap satu proses BE, tapi antrean bounded + batch *(rekomendasi jangka pendek)*; (b) pisah `worker` ingestion sebagai container terpisah (scale independen; alert & push ikut di sana, WS via Redis pub/sub). Apakah Anda berencana >1 instance BE atau >±50 device dengan interval <60 s? Bila ya → (b) lebih dini.

**Q8. Sumber waktu?**
- (a) Simpan waktu device + `receivedAt` server, pakai server bila selisih >5 menit *(rekomendasi)*; (b) selalu waktu server; (c) selalu waktu device. Apakah firmware ESP32 sinkron NTP/RTC? Ini mengikat **kontrak MQTT** (semantik `timestamp`).

**Q9. Registrasi & akun?**
- `expiresAt` per user tampaknya konsep lisensi/masa berlaku. Apakah registrasi tetap terbuka? Opsi: (a) undangan/persetujuan admin; (b) verifikasi email + captcha *(rekomendasi bila tetap terbuka)*; (c) tetap terbuka seperti sekarang. Dan apakah expiry harus memblokir akses **seketika** (rekomendasi: ya, dicek server-side) atau hanya saat login berikutnya?

**Q10. Metrik apa yang harus tampil di mobile (SoC/SoH)?**
- Payload tidak memuat SoC/SoH; dashboard sekarang mengarang angkanya. Opsi: (a) firmware menghitung & mengirim (perlu perubahan **kontrak MQTT**); (b) BE mengestimasi dari tegangan sel (kurang akurat untuk LiFePO4 yang kurvanya datar); (c) tidak menampilkan SoC di v1 *(rekomendasi sampai firmware siap)*.

**Q11. Sumber kebenaran broker Mosquitto & pola deploy?**
- (a) Pakai broker VPS `master_db` yang ada, hapus `MQTT/` dari `include:`, simpan konfigurasi broker itu di repo (`MQTT/` dijadikan template) *(rekomendasi bila broker dipakai project lain)*; (b) pakai container `MQTT/` repo dan matikan yang lama. Bersamaan: build image di CI + registry (GHCR) *(rekomendasi)* vs tetap build di VPS. Trade-off: registry butuh secret tambahan tapi menghilangkan downtime & beban build di VPS.

**Q12. Migrasi API ke `/api/v1` dan domain?**
- (a) Tambah `/api/v1` baru untuk mobile, FE migrasi bertahap dan `/api/*` lama dipertahankan sementara *(rekomendasi)*; (b) langsung migrasikan FE. Apakah sudah ada domain untuk TLS? (tanpa domain: Cloudflare Tunnel atau domain murah; tanpa TLS mobile modern tidak akan mau terhubung.)

**Q13. Hak akses collaborator?**
- Sekarang `editor` = `viewer`. Definisikan: viewer (lihat + terima alert), editor (rename device, ubah ambang alert, ack alert), owner (kelola collaborator, hapus/unclaim). Opsional: transfer kepemilikan. *(rekomendasi: tiga peran seperti di atas)*

---

*Akhir laporan. Tidak ada kode yang diubah; menunggu jawaban atas §7 sebelum implementasi.*
