# BMS Dashboard Redesign — Progress

Branch kerja: **`feat/ui-redesign`** (jangan push ke `main`; push memicu CI/CD auto-deploy).
Commit per fase: `fase-a`, `fase-a5`, `fase-b`, `fase-c-d`.

> Diperbarui di akhir tiap fase. Terakhir: Fase E (polish & hardening).

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

## 5b. Fase E — detail
- **Command palette** ⌘K/Ctrl+K (`CommandPalette`): lompat device (nama/ID), halaman, toggle tema. Keyboard-first (↑↓/↵/esc), fokus dikembalikan, satu global keydown (⌘K, preventDefault).
- **Skeleton** (Dashboard/My Devices/Device Detail) + **ErrorState** dengan tombol retry + **404** (device tak ada / tak punya akses).
- **WS indicator** global di header dari `useWsStatus` (koneksi WS kini singleton via `WsProvider`).
- Angka live `tabular-nums` + `useAnimatedNumber` menghormati `prefers-reduced-motion`.
- **Template TailAdmin dihapus** (lihat §7).

## 6. TODO terbuka

- [ ] **Apply migration `20260924190000_packhistory_current_power` ke DB VPS** (user handle). `/history` 500 sampai kolom ada.
- [ ] Verifikasi duplikasi `PackHistory` (dev+prod subscribe broker sama) — query tertunda (tunnel putus). Gunakan stack lokal agar dev berhenti menulis ke prod.
- [ ] Kalibrasi `LIFEPO4_OCV_SOC` dari data sel asli.
- [ ] Opsional: alarm persistence backend (timeline lintas reload) — kini FE-only.
- [ ] **Merge** dengan `feat/mobile-api-v1` — lihat §8 (rekonsiliasi migration telemetry & `client.ts` & `history/route.ts`).
- [ ] **CI belum menjalankan `prisma migrate deploy`** — lihat §9.

## 7. Template TailAdmin dihapus (Fase E)
Route demo (tak dipakai, hanya di sidebar yang di-comment): `/bar-chart`, `/line-chart`, `/form-elements`, `/basic-tables`, `/blank`, `/calendar`, `/alerts`, `/avatars`, `/badge`, `/buttons`, `/images`, `/modals`, `/videos`. **`/profile` DIPERTAHANKAN** (dipakai UserDropdown).
Komponen demo (0 importer setelah route dihapus): `components/ecommerce/*`, `components/charts/*`, `components/example/*`, `components/videos/*`, `components/calendar/*`, `components/form/form-elements/*`, `components/ui/video/*`, `components/ui/images/*`, `components/tables/*` (BasicTableOne, Pagination), `components/common/{ChartTab,PageBreadCrumb,ComponentCard}.tsx`, `components/form/MultiSelect.tsx`.
Dipertahankan (masih dipakai): `common/GridShape` (auth/error), `form/date-picker`, semua `ui/{badge,button,dropdown,modal,table,alert,avatar}`, `user-profile/*`, `form/input/*`.

## 8. Persiapan merge: `feat/ui-redesign` ↔ `feat/mobile-api-v1`
**File bentrok** (diubah di kedua branch): `schema.prisma`, `mqtt/client.ts`, `server.ts`, `app/api/devices/[id]/history/route.ts`, `app/api/devices/{route,[id]/route}.ts`, `types/device.ts`, `PackCard.tsx`, `page.tsx`, `package.json`, `Dockerfile`, env examples, `.gitignore`, + 5 `Bms*` dummy (delete/modify: ui-redesign menghapus, mobile-api-v1 mengubah).
**Migration tumpang tindih (KRITIS):** mobile-api-v1 punya `20260921140000_history_current_power_and_indexes` (sudah menambah `PackHistory.current/power` + index) dan `20260921130000_ingestion_idempotency` + `20260922110000_add_history_rollups`. ui-redesign punya `20260924180000_telemetry_perf_and_lastseen` + `20260924190000_packhistory_current_power`. → **`packhistory_current_power` akan gagal** (kolom sudah ada) bila kedua branch digabung apa adanya.
**Rekomendasi:** merge/rebase **`feat/mobile-api-v1` dulu** (fondasi auth + idempotency), lalu rebase `feat/ui-redesign` di atasnya sambil: (a) **hapus** `packhistory_current_power` (redundan) & dedupe index di `telemetry_perf_and_lastseen` (sisakan hanya `lastSeen` + index yang belum ada, pakai `IF NOT EXISTS`); (b) merge manual `client.ts` (idempotency mobile + perf ui) & `history/route.ts` (rollups mobile + date_bin/energy ui); (c) `lastSeen` unik milik ui-redesign — pertahankan. `ingestion_idempotency` (unique constraint history) juga **menyelesaikan** TODO duplikasi.

## 9. Checklist deploy
- **CI `deploy.yml` TIDAK menjalankan `prisma migrate deploy`** (hanya `git pull` + `docker compose up --build`). Usul (jangan commit dulu) — tambah langkah setelah `up`:
  ```yaml
              docker compose up -d --build
  +           docker compose exec -T backend npx prisma migrate deploy
              docker image prune -f
  ```
  (atau jadikan entrypoint container: `prisma migrate deploy && node dist/server.js`; pastikan `prisma` CLI ada di image).
- **Env baru di VPS:** `NEXT_PUBLIC_WS_URL=wss://<domain>/ws` (FE, saat build), pool params di `DATABASE_URL` (`?...&connection_limit=10&pool_timeout=20&connect_timeout=10`).
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
