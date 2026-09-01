# Modular Universal BMS — Dashboard Monitoring

Dashboard monitoring untuk **Modular Universal BMS** (Battery Management System) berbasis baterai LiFePO4. Project capstone yang memantau data hierarkis **Device → Pack → Cell** secara real-time dari firmware ESP32 lewat MQTT.

## Arsitektur

Monorepo dengan 3 service independen, diorkestrasi lewat Docker Compose (`include:`), tiap folder bisa dijalankan standalone untuk development.

┌─────────────┐ MQTT ┌─────────────┐ MQTT ┌──────────────┐
│ ESP32 │ ─────publish──> │ MQTT/ │ <───subscribe── │ BE/ │
│ Firmware │ bms/{id}/data │ Mosquitto │ │ GAMA BMS API │
└─────────────┘ └─────────────┘ │ + WS Server │
└──────┬───────┘
│
REST + WebSocket (/ws)
│
┌──────▼───────┐
│ FE/ │
│ GAMA BMS + │
│ TailAdmin │
└──────────────┘

### Skema data (hierarki)

Device (id, owner, verified, collaborators)
└── Pack (index, temperature, balancerConnected)
└── Cell (index, voltage)

- **Cell**: voltage dari voltage divider terkalibrasi
- **Pack**: terhubung ke active balancer (EK-C8S5A), suhu dari DS18B20
- **Device**: jumlah pack/cell dinamis per BMS

## Struktur Folder

.
├── docker-compose.yml # root orchestrator (pakai include:)
├── FE/ # Frontend — GAMA BMS + TailAdmin
├── BE/ # Backend — GAMA BMS Route Handlers + custom WS server + MQTT client
└── MQTT/ # Mosquitto broker

## Stack

| Layer       | Teknologi                                                           |
| ----------- | ------------------------------------------------------------------- |
| Frontend    | GAMA BMS 16 (App Router), TailAdmin, TailwindCSS                    |
| Backend     | GAMA BMS Route Handlers (REST API) + custom Node server (WebSocket) |
| Auth        | Auth.js v5 (Credentials provider, JWT session)                      |
| Database    | PostgreSQL + Prisma ORM                                             |
| MQTT        | Mosquitto broker, `mqtt.js` client di backend                       |
| Realtime FE | WebSocket native (`/ws`)                                            |
| Email       | Nodemailer + Gmail SMTP (reset password)                            |

## Alur Data

ESP32 firmware
--MQTT publish (topic: bms/{device_id}/data)-->
Mosquitto broker
--subscribe-->
Backend (mqtt.js client)
--simpan ke PostgreSQL via Prisma-->
--broadcast via WebSocket (/ws)-->
Frontend (realtime update, tanpa polling)

REST API (`BE/src/app/api/**`) dipakai untuk fetch data non-realtime (list device, riwayat, auth, dll). WebSocket dipakai khusus untuk push update cell/pack secara langsung ke dashboard.

## Development (Local, tanpa Docker)

Saat ini setiap service dijalankan native (`npm run dev`) untuk iterasi cepat. Docker Compose baru dipakai setelah fitur inti (auth minimal, MQTT pipeline) stabil.

### Prasyarat

- Node.js ≥ 20 (via [nvm](https://github.com/nvm-sh/nvm) direkomendasikan)
- Akses ke PostgreSQL (VPS atau lokal)
- Akses ke Mosquitto broker (VPS atau `MQTT/` lokal)

### 1. MQTT Broker

Broker sudah jalan di VPS (`docker-compose.yml` terpisah, service `bms_mosquitto`). Untuk run standalone lokal:

```bash
cd MQTT
docker network create bms-network   # sekali saja
docker compose up --build
```

### 2. Backend (`BE/`)

```bash
cd BE
cp .env.example .env   # isi DATABASE_URL, MQTT_*, NEXTAUTH_SECRET, GMAIL_*
npm install
npx prisma migrate dev
npm run dev
```

Berjalan di `http://localhost:4000` — expose REST API (`/api/*`) dan WebSocket (`/ws`).

**Generate `NEXTAUTH_SECRET`:**

```bash
openssl rand -base64 32
```

**Setup email reset password (Gmail App Password):**

1. Aktifkan 2-Step Verification di akun Gmail pengirim
2. Generate App Password di `myaccount.google.com/apppasswords`
3. Isi `GMAIL_USER` dan `GMAIL_APP_PASSWORD` di `.env` (App Password, bukan password akun)

### 3. Frontend (`FE/`)

```bash
cd FE
npm install --legacy-peer-deps   # next-auth beta belum declare peer range utk Next 16
cp .env.example .env.local       # isi BACKEND_URL, NEXTAUTH_SECRET (sama persis dgn BE)
npm run dev
```

Berjalan di `http://localhost:3001` (atau port lain kalau `:3000` terpakai).

FE mem-proxy request `/api/auth/*` dan `/api/backend/*` ke BE lewat `next.config.ts` (`rewrites()`), supaya cookie session tetap satu origin (browser selalu bicara ke `:3001`, bukan langsung ke `:4000`).

### 4. Docker Compose (full stack, belum aktif penuh)

```bash
docker network create bms-network   # sekali saja
docker compose up --build
```

> Root `docker-compose.yml` pakai `include:` untuk menggabungkan `MQTT/docker-compose.yml`, `BE/docker-compose.yml`, `FE/docker-compose.yml`. Pastikan ketiga file itu ada sebelum menjalankan dari root.

## Environment Variables

### `BE/.env`

| Variabel                          | Keterangan                                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                    | Koneksi PostgreSQL (`sslmode=require` jika akses langsung; `sslmode=disable` jika lewat SSH tunnel) |
| `PORT`                            | Port backend (default `4000`)                                                                       |
| `NEXTAUTH_SECRET`                 | Secret untuk sign JWT session — **harus sama persis** dengan `FE/.env.local`                        |
| `NEXTAUTH_URL`                    | Origin backend (`http://localhost:4000`)                                                            |
| `MQTT_BROKER_URL`                 | Alamat broker Mosquitto                                                                             |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | Kredensial MQTT (kosongkan jika broker `allow_anonymous true`)                                      |
| `GMAIL_USER`                      | Alamat Gmail pengirim email reset password                                                          |
| `GMAIL_APP_PASSWORD`              | App Password 16 karakter (bukan password akun)                                                      |

### `FE/.env.local`

| Variabel          | Keterangan                                                                    |
| ----------------- | ----------------------------------------------------------------------------- |
| `BACKEND_URL`     | Alamat backend untuk proxy rewrites (`http://localhost:4000`)                 |
| `NEXTAUTH_SECRET` | Sama persis dengan `BE/.env`, dipakai `proxy.ts` untuk verifikasi JWT session |

## Konvensi Kontribusi

- Perubahan kontrak payload MQTT (`BmsDevicePayload`, dkk di `BE/src/types/bms.ts`) wajib disertai update dokumentasi firmware ESP32 — ini kontrak lintas repo/lintas tim.
- Perubahan skema database lewat migration Prisma (`npx prisma migrate dev --name <deskripsi>`), jangan edit `schema.prisma` tanpa migration.
- Setiap perubahan yang berdampak ke lebih dari satu folder (FE/BE/MQTT) harus disebutkan secara eksplisit di pesan commit atau PR description.

## Known Limitations / TODO

- [ ] MQTT broker di VPS masih `allow_anonymous true` dan port ter-expose publik — perlu diaktifkan auth (`password_file`) sebelum device asli terhubung di luar lingkungan testing
- [ ] Belum ada tabel history (`CellReading`/`PackReading`) untuk grafik tren voltage/suhu dari waktu ke waktu — saat ini hanya menyimpan state terkini
- [ ] `proxy.ts` melindungi route berdasarkan session, tapi belum ada role-based access control (owner vs collaborator device)
- [ ] Docker Compose full-stack (root `docker-compose.yml`) belum ditest end-to-end karena development masih native
