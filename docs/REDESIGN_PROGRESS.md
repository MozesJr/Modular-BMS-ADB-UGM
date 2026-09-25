# BMS Dashboard Redesign — Progress

Branch kerja: **`feat/ui-redesign`** (jangan push ke `main`; push memicu CI/CD auto-deploy).
Commit per fase: `fase-a`, `fase-a5`, `fase-b`, `fase-c-d`.

> Diperbarui di akhir tiap fase. Terakhir: integrasi `feat/ui-redesign` ↔ `feat/mobile-api-v1` (branch `integrate/redesign`, belum di-push/merge).

---

## 1. Keputusan arsitektur

| Topik | Keputusan | Alasan |
|---|---|---|
| Sumber freshness | `getFreshness(lastSeen)` → live `<25s` / stale `<5m` / offline `≥5m` | Cadence MQTT ~10s; toleransi ~2 paket hilang sebelum "stale". Satu sumber → tak ada kontradiksi status. |
| `Device.lastSeen` | Kolom baru, di-update tiap ingest sukses | Freshness akurat tanpa `max(pack.updatedAt)`. |
| Derivasi cell | Fungsi tunggal `deriveCellStats` (min/max/avg/delta) dipakai di semua tempat | Fix delta beda antara gauge & analytics. |
| SoC | Voltage-based via tabel OCV LiFePO4 piecewise (`LIFEPO4_OCV_SOC`), 2.50 V = 0% | LiFePO4 kurva datar → estimasi; **tabel generik, belum dikalibrasi ke sel**. Ditandai "tidak andal saat berbeban" bila `|I| > 0.2 A`. |
| Chart gap | Sisip `null` bila jarak titik/bucket > 2× interval | Garis putus saat offline, tidak "menyambung" periode mati. |
| Downsample | LTTB di FE (`telemetry.ts`) | Backend belum wajib agregasi; envelope pakai agregasi DB. |
| History | Agregasi DB `date_bin` (Postgres 16), bucket auto | Kurangi row transfer (mis. 720→11) — dominan RTT lewat tunnel. |
| Ingest MQTT | Keluar dari transaksi interaktif; cache id, raw multi-row `ON CONFLICT` (parameterized), batch `$transaction`, antrian per-device | Fix P2028 (35→~5 round-trip/pesan). |
| Alarm & downsample | Dievaluasi di FE (config `alertRules.ts`) | Belum ada persistence backend (bisa diusulkan nanti). |
| Health score | Komposit balance/suhu/freshness, **pack terburuk**; rumus di tooltip | Transparan, bukan angka ajaib. |
| Animasi twin | SVG + CSS murni (tanpa dependency baru), hormati `prefers-reduced-motion` | Konstrain "jangan tambah lib berat". |
| DB dev | Tetap fix kode; disediakan stack lokal (opsional) | Latency dev = SSH tunnel ke VPS; prod co-located cepat. |
| Fleet dashboard | KPI + kartu dari satu `GET /api/devices`; **tanpa sparkline** dulu | Hindari N request; sparkline menunggu endpoint agregat (lihat TODO). |

## 2. Kontrak `GET /api/devices/[id]/history`

Query: `?hours=24&bucket=auto&cells=0|1`
Bucket auto: `≤6h→30s`, `≤24h→120s`, else `900s` (7 hari). Override `bucket=<detik>` (clamp 10..3600).

```jsonc
{
  "from": "ISO", "to": "ISO", "hours": 24, "bucketSeconds": 120,
  "packs": [{
    "index": 1,
    "buckets": [{
      "t": "ISO",
      "cellMin": 3.31, "cellMax": 3.36, "cellAvg": 3.34, "deltaMv": 50,
      "tempAvg": 27.4, "currentAvg": -1.2, "powerAvg": -60.5,
      "energyWh": -2.1, "energyInWh": 3.0, "energyOutWh": 0.9, "balancerOn": true
    }],
    "cells": [{ "index": 1, "points": [{ "t": "ISO", "vAvg": 3.34 }] }] // hanya jika cells=1
  }]
}
```

**Energi (integrasi trapezoid):** untuk tiap pasangan sampel berurutan (`prev`,`curr`) dalam satu pack,
kontribusi = `((power_curr + power_prev) / 2) × Δt_detik / 3600`, `Δt = recordedAt_curr − recordedAt_prev`.
Segmen dengan `Δt > 2× interval (20s)` = **gap offline**, diabaikan (kontribusi 0); diatribusikan ke bucket sampel akhir.
- `energyWh` = jumlah kontribusi (**net, bertanda**; negatif = net charging) — kompatibilitas.
- `energyInWh` = Σ |kontribusi negatif| (charge, **positif**).
- `energyOutWh` = Σ kontribusi positif (discharge, **positif**).
Jadi energi hanya dari durasi yang benar-benar terisi (bukan durasi bucket penuh). Sumber: `PackHistory.power`.

## 2b. Kontrak `GET /api/devices/summary?hours=6`

Akses **identik** dengan `GET /api/devices` (owner ATAU collaborator) — diverifikasi dengan 2 user (A owner semua, B collaborator 1 device → B hanya melihat 1). Bucket dipilih agar ≤ ~60 titik/device. 2 query GROUP BY (delta cell dari CellHistory, avg power dari PackHistory) + 1 query metadata — **bukan N query**.
```jsonc
{
  "hours": 6, "bucketSeconds": 360,
  "devices": [{
    "id": "...", "serialNumber": "...", "name": "...", "verified": true, "lastSeen": "ISO",
    "packCount": 2, "cellCount": 8,
    "spark": [{ "t": "ISO", "deltaMv": 15, "powerW": -60.5 }]  // downsampled; powerW = packCount × avg(power)
  }]
}
```
DeviceCard merender sparkline SVG kecil (tanpa lib), gap saat bucket kosong.

## 3. Util bersama (FE) + konstanta

| File | Ekspor | Konstanta penting |
|---|---|---|
| `lib/freshness.ts` | `getFreshness`, `formatAge`, `FRESHNESS_META` | `SAMPLING_INTERVAL_MS=10000`, `FRESHNESS_LIVE_MS=25000`, `FRESHNESS_STALE_MS=300000` |
| `lib/packMetrics.ts` | `deriveCellStats`, `estimateSocPercent`, `socFromCellVoltage`, `isSocReliable`, `cellDeviationsMv`, `currentDirection`, `deviationColor`, `clamp` | `LIFEPO4_OCV_SOC` (tabel), `SOC_LOAD_THRESHOLD_A=0.2`, `CURRENT_IDLE_THRESHOLD_A=0.05`, `NOMINAL_LIFEPO4_V_PER_CELL=3.2` |
| `lib/telemetry.ts` | `insertGaps`, `lttbDownsample`, `prepareSeries`, `autoRange` | `GAP_THRESHOLD_MS=2×interval=20000` |
| `lib/alertRules.ts` | `evaluateSnapshot`, `evaluateHistoryEpisodes`, `ALARM_LABELS` | `ALERT_THRESHOLDS`: OV `3.65`, UV `2.50`, temp `45`, imbalance warn `20` / crit `50` mV |
| `lib/healthScore.ts` | `computeHealthScore`, `healthColor`, `healthFormula` | bobot `balance 0.4 / suhu 0.3 / freshness 0.3`; balance 0 di delta ≥100 mV; suhu ideal 15–35 °C |
| `lib/realtimeMerge.ts` | `applyRealtimeUpdate` | merge event WS `bms:update` ke `Device` (dipakai DeviceDetail, FleetDashboard, DeviceList) |
| `context/WsContext.tsx` | `WsProvider`, `useWsStatus`, `useBmsSocket` | **SATU** koneksi WS untuk seluruh app + status global (connecting/connected/disconnected) |

Komponen bersama: `DeviceCard` (varian `compact` = Dashboard, `detailed` = My Devices) + `deviceSummary()` + `Sparkline`.
`BatteryTwin`, `Heartbeat`, `HealthRing`, `CellBalanceChart`, `AlarmTimeline` (Device Detail).
Polish: `CommandPalette` (⌘K), `WsIndicator`, `Skeleton`/`CardGridSkeleton`, `ErrorState` (retry).

## 4. Stack dev lokal (opsional — tidak menyentuh prod)

File: `docker-compose.dev.yml`, `MQTT/config.dev/mosquitto.conf`, `tools/simulator/`, `BE/.env.development.example`.

```bash
# 1. Jalankan stack (postgres-dev :5433, mosquitto-dev :1883, simulator 3 device)
docker compose -f docker-compose.dev.yml up -d

# 2. Migrasi schema ke DB lokal (sekali)
cd BE && DATABASE_URL="postgresql://bms_user:devpass@localhost:5433/bms_db?sslmode=disable" \
  npx prisma migrate deploy

# 3. Jalankan BE + FE dev pakai env lokal
cp BE/.env.development.example BE/.env.development   # lalu jalankan BE dengan env ini
#   BE: DATABASE_URL(:5433) + MQTT_BROKER_URL(mqtt://localhost:1883)
#   FE: BACKEND_URL=http://localhost:4000, NEXT_PUBLIC_WS_URL=ws://localhost:4000/ws
```

Simulator (`tools/simulator/index.mjs`): env `MQTT_URL`, `DEVICE_COUNT` (1–3), `INTERVAL_MS` (default 10000).
Fleet: `DEV-SIM-001` (1 pack×8), `DEV-SIM-002` (2 pack×4), `DEV-SIM-003` (1 pack×16). Variasi LiFePO4
3.25–3.45 V, fase charge/discharge bergantian (current negatif = charging), imbalance >50 mV sesekali, suhu 26–40 °C.
Device auto-provisioned `ownerId=null` → klaim lewat POST `/api/devices` (atau set `ownerId` manual saat dev).

## 5. Status fase

| Fase | Isi | Status |
|---|---|---|
| A | Bug fix (sidebar, urutan cell, delta, chart gap/zoom, validasi form) + util freshness/derivasi/telemetry | ✅ |
| A.5 | Perf & realtime backend (ingest, history agregasi, WS fix, index, lastSeen, tooling) | ✅ (migration `telemetry_perf_and_lastseen` applied; `packhistory_current_power` **pending apply ke VPS**) |
| B | Device Detail: twin, heartbeat, cell balance, envelope, alarm, health | ✅ |
| C | Dashboard fleet (KPI nyata, DeviceCard, hapus dummy) | ✅ |
| D | My Devices (DeviceCard detailed, filter/search/sort) | ✅ |
| E | Polish & hardening (command palette, skeleton, error/retry, 404, WS indicator, energy in/out, summary endpoint + sparkline, hapus template cruft) | ✅ |
| Integrasi | Merge dengan `feat/mobile-api-v1` (branch `integrate/redesign`) — lihat §8–11 | ✅ lokal, belum di-push. Migrasi VPS **belum dijalankan** (prosedur §9 siap, perlu dieksekusi manual). |
| Fleet Dashboard v2 | Redesign Dashboard (Fleet Overview): 3 bug data + 6 fitur baru + kontrak energi hari ini — lihat §12 | ✅ branch `feat/fleet-dashboard-v2` (belum di-push) |

## 5b. Fase E — detail
- **Command palette** ⌘K/Ctrl+K (`CommandPalette`): lompat device (nama/ID), halaman, toggle tema. Keyboard-first (↑↓/↵/esc), fokus dikembalikan, satu global keydown (⌘K, preventDefault).
- **Skeleton** (Dashboard/My Devices/Device Detail) + **ErrorState** dengan tombol retry + **404** (device tak ada / tak punya akses).
- **WS indicator** global di header dari `useWsStatus` (koneksi WS kini singleton via `WsProvider`).
- Angka live `tabular-nums` + `useAnimatedNumber` menghormati `prefers-reduced-motion`.
- **Template TailAdmin dihapus** (lihat §7).

## 6. TODO terbuka

- [ ] **Apply migration ke DB VPS** dengan prosedur rekonsiliasi khusus (bukan `migrate deploy` polos) — lihat §8c. Sampai ini dijalankan, `/history` & `/summary` di prod masih memakai kode lama (branch belum di-push/merge ke `main`).
- [ ] Verifikasi duplikasi `PackHistory` (dev+prod subscribe broker sama) — kini **sebagian terjawab**: migrasi mobile `ingestion_idempotency` menambah unique constraint `(deviceId,packIndex,recordedAt)` dan ingest pakai `createMany({ skipDuplicates: true })`, jadi redelivery/duplikat dari broker yang sama otomatis idempoten setelah migration ini di-apply ke VPS. Query pengukuran langsung masih tertunda (tunnel putus).
- [ ] Kalibrasi `LIFEPO4_OCV_SOC` dari data sel asli.
- [ ] Opsional: alarm persistence backend (timeline lintas reload) — kini FE-only.
- [ ] Pertimbangkan pakai `PackRollup1m`/`CellRollup1m` (mobile) untuk `/history` bila UI kelak butuh rentang >30 hari — lihat keputusan §8b (untuk sekarang sengaja TIDAK dipakai).
- [x] ~~Merge dengan `feat/mobile-api-v1`~~ — **selesai**, lihat §8 (branch `integrate/redesign`, belum di-push).
- [ ] **CI belum menjalankan `prisma migrate deploy`** — diusulkan di §9 (diff, belum di-commit).

## 7. Template TailAdmin dihapus (Fase E)
Route demo (tak dipakai, hanya di sidebar yang di-comment): `/bar-chart`, `/line-chart`, `/form-elements`, `/basic-tables`, `/blank`, `/calendar`, `/alerts`, `/avatars`, `/badge`, `/buttons`, `/images`, `/modals`, `/videos`. **`/profile` DIPERTAHANKAN** (dipakai UserDropdown).
Komponen demo (0 importer setelah route dihapus): `components/ecommerce/*`, `components/charts/*`, `components/example/*`, `components/videos/*`, `components/calendar/*`, `components/form/form-elements/*`, `components/ui/video/*`, `components/ui/images/*`, `components/tables/*` (BasicTableOne, Pagination), `components/common/{ChartTab,PageBreadCrumb,ComponentCard}.tsx`, `components/form/MultiSelect.tsx`.
Dipertahankan (masih dipakai): `common/GridShape` (auth/error), `form/date-picker`, semua `ui/{badge,button,dropdown,modal,table,alert,avatar}`, `user-profile/*`, `form/input/*`.

## 8. Integrasi `feat/ui-redesign` ↔ `feat/mobile-api-v1` — SELESAI

Branch **`integrate/redesign`** dibuat dari `feat/mobile-api-v1`, lalu `feat/ui-redesign` di-**merge** (bukan rebase) ke atasnya. **Belum di-push.**

**Kenapa merge, bukan rebase:** mobile-api-v1 menulis ulang backend secara mendalam (`mqtt/ingest.ts`+`schema.ts`+`timestamp.ts`, wrapper `lib/authz.ts`+`lib/http.ts`, API v1 penuh, 180 test) sedangkan commit ui-redesign menyentuh BE hanya di beberapa file per fase. Rebase akan mereplay tiap commit ui-redesign di atas basis yang terus berubah dan memaksa resolusi konflik berulang untuk file yang sama (`client.ts`, `server.ts`, `history/route.ts` muncul di 3 commit ui-redesign berbeda). Merge menyelesaikan tiap file **tepat sekali**.

### 8a. Resolusi konflik non-trivial

| File | Konflik | Resolusi |
|---|---|---|
| `mqtt/client.ts` | Redesign menulis DB langsung (cache id + antrian + raw upsert); mobile split jadi `client.ts`(parse+validasi)+`ingest.ts`(queue+persist)+`schema.ts`+`timestamp.ts` | Ambil **mobile utuh** — superset (validasi schema, `resolveRecordedAt`, structured logger, keyed queue). Kode ingest redesign dibuang total. |
| `mqtt/ingest.ts` | Tidak konflik git (file murni mobile) tapi **perlu tambahan**: `Device.lastSeen` (satu-satunya hal di redesign yang tak dimiliki mobile) | Tambah 1 statement `UPDATE "Device" SET "lastSeen"=...` di awal transaksi `persistSnapshot`, dengan staleness-guard sama seperti `Pack.recordedAt` (`WHERE lastSeen IS NULL OR lastSeen <= receivedAt`). Diverifikasi: 9 test `ingest.db.test.ts` tetap hijau. |
| `server.ts` | Redesign fix DEP0169 (`handle(req,res)` tanpa `parsedUrl`); mobile graceful-shutdown lengkap tapi masih pakai `url.parse` | Ambil **mobile utuh** untuk shutdown/health/PEER_HEADER, tapi **drop** `import { parse } from "url"` + panggilannya — pakai `handle(req, res)` polos (Next terima tanpa parsedUrl). |
| `schema.prisma` (`PackHistory`/`CellHistory`) | Redesign nambah `current`/`power`+index; mobile nambah itu **plus** `receivedAt`, unique index idempotensi | Ambil **mobile utuh** (superset). `Device.lastSeen` (bagian yang tak konflik) tetap masuk. |
| `prisma/migrations` | Lihat §8b | — |
| `devices/[id]/history/route.ts` | Redesign: kontrak bucket `date_bin` baru (envelope+energi); mobile: route lama tak berubah, hanya dibungkus `route()`/`assertCanView` | **Pertahankan kontrak redesign**, tapi bungkus dengan `route()`+`assertCanView` milik mobile (format error `{error:{code,message}}` + 404/403 terpusat, konsisten dgn seluruh API). Rollup mobile **tidak dipakai** — lihat §8b. |
| `(admin)/page.tsx` + 4 `Bms*.tsx` | Redesign hapus semua (ganti `FleetDashboard`); mobile perbaiki `BmsSystemMetrics` (pakai `/api/v1/dashboard/summary`) tapi `BmsPowerFlowChart`/`BmsVoltageTrendChart` masih eksplisit berkomentar "DEMO: data contoh" | Ambil **redesign** (`FleetDashboard`, data nyata penuh dari `/api/devices`+`/api/devices/summary`, tanpa dummy). Endpoint `/api/v1/dashboard/summary` yang dikonsumsi `BmsSystemMetrics` **tetap ada** untuk mobile app — hanya konsumen web-nya yang dihapus. |
| `PackCard.tsx` | Redesign restrukturisasi total (Twin+CellBalance); mobile tambah prop `emptyText`/`emptyTitle` di satu gauge Suhu (`Gauge.tsx`, tak konflik) | Pertahankan struktur redesign, porting `emptyText="Error"` ke gauge Suhu di lokasi barunya (beda sensor error vs 0 °C). |
| `devices/route.ts`, `devices/[id]/route.ts`, `types/device.ts`, `Gauge.tsx`, `package.json`, `Dockerfile`, `next.config.ts`, `lib/api.ts` | — | **Auto-merged bersih oleh git**, diverifikasi manual satu-satu: pola `route()`/zod mobile + fix `orderBy` pack/cell redesign sama-sama utuh; `engines`, `node:22`, `/api/v1` rewrite, `ApiError{code,message}` parsing semua ada. |

### 8b. Keputusan: TIDAK memakai `PackRollup1m`/`CellRollup1m` untuk `/history`

Mobile punya tabel rollup 1-menit + `scripts/retention.ts` (hapus raw >30 hari). `/history` redesign tetap membaca `PackHistory`/`CellHistory` **raw** untuk semua rentang (6j/24j/7hari), TIDAK fallback ke rollup. Alasan:
1. Retensi raw 30 hari sudah menutupi seluruh rentang yang dipakai UI (maksimal 7 hari) — tidak ada baris yang hilang.
2. Rollup hanya terisi lewat `node dist/scripts/retention.js --execute`, yang **tidak terjadwal otomatis** (dijalankan manual/cron eksternal, belum ada di compose manapun). Memakainya sebagai sumber utama berisiko silent-empty-result di dev/staging/VPS baru sebelum cron pertama jalan.
3. `prisma migrate diff` & test suite membuktikan raw-only sudah benar untuk kontrak saat ini.
**TODO** bila UI kelak menambah opsi rentang >30 hari: tambah fallback ke rollup untuk porsi `recordedAt < now-30d`, dengan agregasi berbobot `samples` (rollup sudah menyimpan `count` per metrik untuk itu).

### 8c. Migration: rekonsiliasi & verifikasi

**Dihapus:** `20260924190000_packhistory_current_power` — kolom `current`/`power` di `PackHistory` sudah ditambah migrasi mobile `20260921140000_history_current_power_and_indexes`, jadi 100% redundan.

**Dikurangi:** `20260924180000_telemetry_perf_and_lastseen` — semula juga membuat index `PackHistory_deviceId_recordedAt_idx` & `CellHistory_deviceId_recordedAt_idx`, yang NAMA DAN DEFINISINYA SAMA PERSIS dengan yang dibuat migrasi mobile `20260921140000_history_current_power_and_indexes`. Kedua `CREATE INDEX` itu **dihapus** dari migrasi ini — yang tersisa hanya `ALTER TABLE "Device" ADD COLUMN "lastSeen"`.

**Verifikasi migration chain (dijalankan, bukan asumsi):**
```bash
# 1. Replay 11 migrasi dari kosong ke DB sekali-pakai -> harus sukses tanpa error
DATABASE_URL=<db-kosong> npx prisma migrate deploy
# hasil: "All migrations have been successfully applied." (11 folder, urutan benar)

# 2. Diff hasil replay vs schema.prisma final -> HARUS KOSONG
npx prisma migrate diff --from-url <db-kosong> --to-schema-datamodel ./prisma/schema.prisma --script
# hasil: "-- This is an empty migration."
```
Kedua-duanya **sudah dijalankan dan lolos** (lihat riwayat kerja sesi ini) — migration chain terbukti benar untuk DB yang belum pernah disentuh (mis. `postgres-dev` di stack lokal, atau DB VPS baru).

**⚠️ DB VPS bukan "DB kosong"** — di Fase A.5, migrasi `20260924180000_telemetry_perf_and_lastseen` versi LAMA (dengan 2 `CREATE INDEX` yang sekarang dihapus) **sudah pernah di-apply langsung ke DB VPS** (lewat SSH tunnel). Akibatnya VPS punya kolom `lastSeen` **dan** kedua index itu, tapi belum satupun migrasi mobile. Ini diverifikasi persis (bukan tebakan) dengan mereplika state itu di DB sekali-pakai lokal: `prisma migrate deploy` di atas state itu **gagal P3018** persis di migrasi `20260921140000_history_current_power_and_indexes` — `relation "PackHistory_deviceId_recordedAt_idx" already exists`. Prosedur remediasi lengkap (diuji sampai lolos + `migrate status` "up to date" + `migrate diff` kosong) ada di §9.

## 9. Migrasi ke DB VPS — perintah persis (jalankan MANUAL, satu kali)

Ini prosedur **rekonsiliasi satu-kali** (bukan `migrate deploy` polos) karena state khusus VPS di §8c. Sudah diuji sampai lolos di replika lokal DB VPS (bukan asumsi). Jalankan dari VPS, di direktori project (mis. `/home/Modular-BMS-ADB-UGM`), **setelah** kode branch ini ada di sana (`git pull`) tapi **sebelum** merestart service `backend`:

```bash
# 0. Lihat status SEBELUM — harus tampil 5 migrasi mobile "not yet applied", TANPA error.
docker compose --profile tools run --rm backend-migrate npx prisma migrate status

# 1. Migrasi 20260921140000_history_current_power_and_indexes akan gagal (P3018: index sudah ada) —
#    migrasi lama pernah dijalankan manual ke DB ini (Fase A.5) dan sudah membuat index bernama SAMA.
#    Hapus index duplikat itu dulu (aman: migrasi mobile akan membuatnya ulang tepat setelah ini):
cat <<'SQL' > /tmp/drop-dup-idx.sql
DROP INDEX IF EXISTS "PackHistory_deviceId_recordedAt_idx";
DROP INDEX IF EXISTS "CellHistory_deviceId_recordedAt_idx";
SQL
docker compose --profile tools run --rm -v /tmp/drop-dup-idx.sql:/tmp/drop-dup-idx.sql:ro \
  backend-migrate npx prisma db execute --schema prisma/schema.prisma --file /tmp/drop-dup-idx.sql

# 2. Jalankan migrasi (skenario NORMAL setelah langkah 1: lolos semua, lanjut ke langkah 4)
docker compose --profile tools run --rm backend-migrate

# 3. HANYA JIKA langkah 2 masih gagal P3018 di migrasi yang sama (mis. langkah 1 belum sempat jalan):
#    tandai upaya yang gagal itu sebagai rolled-back (transaksinya memang sudah di-rollback oleh Postgres),
#    lalu ulangi langkah 2.
docker compose --profile tools run --rm backend-migrate \
  npx prisma migrate resolve --rolled-back 20260921140000_history_current_power_and_indexes
docker compose --profile tools run --rm backend-migrate

# 4. Verifikasi SESUDAH — harus persis: "Database schema is up to date!"
docker compose --profile tools run --rm backend-migrate npx prisma migrate status

# 5. Baru sekarang restart backend (image baru + prisma client baru)
docker compose down
docker compose up -d --build
docker image prune -f
```

Migrasi setelah ini (yang tidak punya sejarah "diterapkan manual" seperti kasus di atas) cukup `docker compose --profile tools run --rm backend-migrate` biasa — langkah 1/3 di atas adalah **khusus untuk transisi ini saja**, jangan dijadikan bagian permanen dari `deploy.yml`.

## 10. Checklist & usulan deploy.yml

- **CI `deploy.yml` TIDAK menjalankan migrasi apa pun** (hanya `git pull` + `docker compose up --build`). Service `backend-migrate` (profile `tools`) sudah ada di `BE/docker-compose.yml` (dibuat mobile-api-v1) tapi tidak pernah dipanggil otomatis. Usul diff (belum di-commit; jalankan §9 manual dulu untuk migrasi PERTAMA kali karena butuh langkah rekonsiliasi, baru tambahkan langkah ini untuk migrasi-migrasi berikutnya):
  ```diff
   name: Deploy to VPS
   ...
             script: |
               cd /home/Modular-BMS-ADB-UGM
               git pull origin main
  +           docker compose --profile tools run --rm backend-migrate
               docker compose down
               docker compose up -d --build
               docker image prune -f
  ```
  `backend-migrate` sudah dibangun dari stage `migrator` (punya Prisma CLI; image `runner` produksi sengaja tanpa itu) dan CMD default-nya persis `npx prisma migrate deploy`.
- **Env baru di VPS:** `NEXT_PUBLIC_WS_URL=wss://<domain>/ws` (FE, saat build), pool params di `DATABASE_URL` (`?...&connection_limit=10&pool_timeout=20&connect_timeout=10`), **`JWT_ACCESS_SECRET`** (wajib sejak mobile-api-v1 — minimal 32 karakter, HARUS beda dari `NEXTAUTH_SECRET`; server menolak start tanpa ini, lihat `BE/src/lib/env-check.ts`).
- **Nginx/Cloudflare Tunnel:** proxy upgrade WebSocket di path `/ws` ke backend:4000 —
  ```nginx
  location /ws {
    proxy_pass http://backend:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
  }
  ```
  (Cloudflare Tunnel: aktifkan WebSocket; pastikan `wss://` di FE.)

## 11. Kompatibilitas kontrak mobile (Flutter) — dikonfirmasi

Endpoint `/api/v1/*` (dipakai Flutter): `auth/{login,logout,logout-all,refresh}`, `me`, `devices`, `devices/[id]`, `devices/[id]/history`, `devices/[id]/collaborators[/[userId]]`, `dashboard/summary`. **Tidak satu pun diubah** oleh integrasi ini — seluruh isi `app/api/v1/` murni ditambahkan dari `feat/mobile-api-v1`, tidak disentuh sisi redesign sama sekali (dikonfirmasi via diff, bukan asumsi).

Satu-satunya efek tidak langsung: kolom baru `Device.lastSeen` otomatis ikut ter-serialize di respons **web** `GET /api/devices` & `GET /api/devices/[id]` (route itu meng-`include` seluruh model `Device` tanpa `select`) — perubahan **aditif**, bukan breaking. **Tidak memengaruhi v1**: route v1 memakai DTO eksplisit (`device-dto.ts`) dengan daftar field tetap (`id,serialNumber,name,verified,role,owner,online,lastSeenAt,packCount,...`) yang tidak menyertakan `Device.lastSeen` — mereka sudah punya konsep freshness sendiri (`lastSeenAt`/`online`, diturunkan dari `Pack.receivedAt`/`updatedAt`, threshold default 180 detik via `device-view.ts`).

**Diverifikasi hidup** (stack lokal, migrasi dari kosong, simulator 3 device): `POST /api/v1/auth/login` → access+refresh token; `GET /api/v1/devices` (Bearer) → daftar device dengan `summary` per pack (voltageV/currentA/powerW/temperatureC/cellDeltaMv) — shape utuh, tidak berubah; `GET /api/v1/me` → profil user. Juga: `GET /api/devices` (web), `GET /api/devices/[id]` (Twin+gauges+cell balance), `GET /api/devices/[id]/history?hours=6|24|168` (envelope, bucketSeconds 30/120/900, energyIn/Out/Wh terisi), `GET /api/devices/summary?hours=6` (sparkline dashboard) — semua 200 dengan data nyata dari 3 device simulator, dan `Device.lastSeen` terisi (bukti transaksi `ingest.ts` yang dimodifikasi berjalan benar). `npm run test:db` (17 file, 180 test, termasuk `ingest.db.test.ts`+`history.db.test.ts`+`token-sessions.db.test.ts`) semua lolos setelah merge.

## 12. Fleet Dashboard v2 (branch `feat/fleet-dashboard-v2`)

Redesign Dashboard (Fleet Overview) — TANPA angka palsu/placeholder, semua dari `/api/devices` + `/api/devices/summary` + WS `bms:update`. Branch dari `main`, belum di-push.

### 12a. Bug data diperbaiki

| # | Bug | Root cause | Fix |
|---|---|---|---|
| 1 | Kartu offline bilang "belum ada data" walau ada nilai terakhir | `deviceSummary()` (dulu di `DeviceCard.tsx`) cuma pakai `Device.lastSeen` mentah; `DeviceDetail.tsx` sudah punya fallback `max(pack.updatedAt)` tapi tidak dipakai di jalur Dashboard | `resolveLastSeenMs()` + `hasNeverReportedData()` baru di `lib/freshness.ts` — SATU implementasi dipakai `DeviceDetail` **dan** `lib/deviceSummary.ts`. Kartu sekarang beda tegas: `neverReported` → nilai disembunyikan ("Device belum pernah mengirim data"); offline dengan last-known → label "Last known · <umur>" + nilai diredupkan |
| 2 | KPI "Alarm Aktif"/"Imbalance Terburuk" ikut hitung device offline | Reduce di `FleetDashboard.tsx` tanpa filter freshness; `evaluateSnapshot` menyuntik pseudo-alarm `rule:"offline"` yang ikut ke-count | `deviceSummary.realAlarms` (exclude `rule==="offline"`); `lib/fleetKpi.ts` hanya agregasi dari device **live** (`activeAlarmCount`, `chargeW`/`dischargeW`, `worst` imbalance). Offline dihitung terpisah (`offlineCount`) sebagai status, bukan imbalance aktif |
| 3 | "Daya Live" tanpa arah | Sum `pack.power` mentah (charge & discharge saling meniadakan) | `fleetKpi.chargeW`/`dischargeW`/`netW` (split by sign, konvensi current negatif = charging), ditampilkan terpisah + net di Fleet Pulse & KPI strip |

### 12b. Komponen baru (`FE/src/components/bms/`)

`FleetPulse` (hero: charge/discharge/net, SVG energy-flow reuse `.twin-flow`/`useReducedMotion` dari BatteryTwin, bar live/stale/offline, ticker packet terakhir, energi hari ini), `CellWall` (heatmap live+last-known per device→pack, hatch overlay untuk non-live, device offline >24j collapsed default, klik→detail), `NeedsAttention` (prioritas alarm>stale>offline>nearing-threshold), `HealthDistribution` (bar health terurut), `LiveEventFeed` (buffer 50 event WS: packet throttled + transisi freshness + alarm muncul/hilang, dihitung FE karena backend cuma broadcast `bms:update`).

`DeviceCard` (compact v2): panah arah+daya (`↑`/`↓` + W), freshness jujur (fix bug 1), chip alarm pakai `realAlarms`, sparkline & cell-strip lama tetap.

### 12c. Util baru/diperluas (reuse, bukan duplikasi)

`lib/deviceSummary.ts` (diekstrak dari `DeviceCard.tsx`, dipakai semua komponen `bms/*` + `DeviceCard`), `lib/fleetKpi.ts` (`computeFleetKpi`). **Tidak** ada cache lintas-render manual (ref-during-render dilarang oleh `react-hooks/refs` eslint rule proyek ini) — komponen berat per-device (`CellWall`, `DeviceCard`) menghitung `deviceSummary()` sendiri dari props `{device, nowMs}` dan di-`React.memo`, supaya update WS satu device tidak memaksa re-render device lain; komponen agregat (KPI, Needs Attention, Health Distribution, Live Event Feed) memakai `Map` yang dihitung `useMemo` murni per render.

### 12d. Kontrak baru: `GET /api/devices/summary` — energi hari ini

```jsonc
{
  "hours": 6, "bucketSeconds": 360,
  "energyToday": { "sinceUtc": "2026-09-20T17:00:00.000Z" }, // batas 00:00 WIB, dihitung DI SQL
  "devices": [{ "...": "...", "energyTodayInWh": 25.3, "energyTodayOutWh": 18.1 }]
}
```
Implementasi `BE/src/lib/energy.ts` (`computeEnergyToday`): batas hari `date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta'` (SQL, bukan JS — hindari skew timezone app server; `now()` overridable via param `{now}` khusus untuk tes deterministik). Integrasi trapezoid daya **sama** dengan `devices/[id]/history/route.ts` (`ENERGY_GAP_S` di-share dari `lib/energy.ts`, history route tak lagi punya konstanta sendiri) — bedanya, segmen yang melintasi batas 00:00 WIB **dipotong** (interpolasi linear power di titik potong), bukan didrop seperti `/history`. Aturan gap (>2× interval sampling) tetap dievaluasi dari segmen penuh, sebelum dipotong. Akses identik `/api/devices` (owner ATAU collaborator). Test: `BE/src/lib/energy.db.test.ts` (5 test — sinceUtc, segmen lintas batas, gap tetap didrop, charge vs discharge terpisah, filter deviceIds).

### 12e. Keputusan & asumsi

- "Live" untuk semua KPI/Fleet Pulse/worst-imbalance = `freshness.status === "live"` saja (bukan live+stale) — dikonfirmasi user.
- Cell Wall: device offline >24 jam collapsed default (bisa di-expand), dibedakan visual dari live via hatch overlay + label umur data (bukan warna saja — kontras 4.5:1 dijaga di teks).
- Energi hari ini ditampilkan ringkas (total fleet di Fleet Pulse, per-device di tooltip stat "Daya" pada `DeviceCard`) — bukan komponen tersendiri, karena prioritas terendah di scope.
- Tanpa dependency baru: ApexCharts sudah ada di `package.json` tapi tidak dipakai (semua visual baru = SVG/CSS custom, konsisten dengan `BatteryTwin`).

### 12f. Verifikasi

- `npx tsc --noEmit` bersih (FE & BE), `next build` bersih (FE & BE, Node 22).
- `npm run test:db` BE: 185/185 lolos (termasuk 5 test energi baru + suite existing tak ada regresi dari refactor `history/route.ts`).
- `eslint .` (FE): nol error/warning baru dari kode branch ini; error `react-hooks/set-state-in-effect`/`react-hooks/purity` yang tersisa (`FleetDashboard.tsx` baris `load(ref)`, `DeviceCard.tsx` default param `nowMs = Date.now()`) **pre-existing di `main`** (dikonfirmasi via `git diff main`), di luar scope task ini.
- Diuji hidup di stack lokal (`docker-compose.dev.yml` + simulator `DEVICE_COUNT` 3→2): 3 device live normal (Fleet Pulse/Cell Wall/Health Distribution/Live Event Feed semua terisi data nyata) → satu device (`DEV-SIM-003`) dimatikan (simulator host diganti ke 2 device) → transisi live→stale→offline teramati real-time di UI (badge, Cell Wall hatch, Needs Attention, Live Event Feed) tanpa reload. Imbalance mendekati/​melewati ambang (15% chance/tick di simulator) teramati di "Imbalance Terburuk" & Needs Attention. Light/dark/390px diverifikasi.
