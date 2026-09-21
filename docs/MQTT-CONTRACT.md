# Kontrak MQTT — Modular Universal BMS

Kontrak antara **firmware ESP32** dan **backend** (`BE/src/mqtt/`). Sumber kebenaran mesin-baca: skema zod di
[`BE/src/mqtt/schema.ts`](../BE/src/mqtt/schema.ts). JSON Schema hasil generate: [`mqtt-payload.schema.json`](./mqtt-payload.schema.json)
(`cd BE && npm run mqtt:schema`).

> **Aturan perubahan:** setiap perubahan pada dokumen atau skema ini adalah perubahan kontrak. Wajib: update dokumen +
> beri tahu tim firmware + cek dampak ke backend (`BE/`), web (`FE/`) dan aplikasi mobile (`mobile/`).

## 1. Topik

| Topik | Arah | QoS | Retained | Status |
|---|---|---|---|---|
| `bms/{device_id}/data` | device → broker → backend | 1 | tidak | **Aktif** |
| `bms/{device_id}/status` | device → broker → backend | 1 | **ya** (LWT `offline`) | **Rencana (B6)** — belum aktif; lihat §6 |

- `device_id` = `Device.serialNumber` di database. Regex: `^[A-Za-z0-9._-]{1,64}$` (tanpa `/`, `+`, `#`, spasi).
- Backend subscribe `bms/+/data` (QoS 1). Topik lain diabaikan.

## 2. Payload `bms/{device_id}/data`

JSON UTF-8, **maksimum 65.536 byte**. Field tak dikenal dibuang (tidak ditolak).

```json
{
  "timestamp": 1790000000000,
  "packs": [
    {
      "index": 0,
      "temperature": 27.5,
      "balancerConnected": true,
      "current": -1.25,
      "power": -67.3,
      "cells": [
        { "index": 0, "voltage": 3.31 },
        { "index": 1, "voltage": 3.32 }
      ]
    }
  ]
}
```

| Field | Tipe | Wajib | Satuan / aturan | Rentang diterima |
|---|---|:-:|---|---|
| `timestamp` | integer | ya | Unix epoch **milidetik** dari jam device (lihat §3) | 0 … 2^53−1 |
| `packs` | array | ya | 1 … 16 pack; `packs[].index` unik | — |
| `packs[].index` | integer | ya | indeks pack, mulai 0 | 0 … 63 |
| `packs[].temperature` | number | ya | **°C** (DS18B20) | −60 … 150 |
| `packs[].balancerConnected` | boolean | ya | status active balancer EK-C8S5A | — |
| `packs[].current` | number | tidak | **A**; **negatif = charging, positif = discharging** (ACS712-05B). Boleh dihilangkan/`null` | −1000 … 1000 |
| `packs[].power` | number | tidak | **W** = tegangan pack × arus. Boleh dihilangkan/`null` | ±1.000.000 |
| `packs[].cells` | array | ya | 1 … 64 cell; `cells[].index` unik per pack | — |
| `packs[].cells[].index` | integer | ya | indeks cell, mulai 0 | 0 … 255 |
| `packs[].cells[].voltage` | number | ya | **V** (hasil kalibrasi voltage divider) | 0 … 10 |

**Tidak ada SoC/SoH** di payload (belum didefinisikan). Aplikasi tidak menampilkannya di v1.

Catatan sensor: bila DS18B20 terputus (mis. pembacaan −127 °C) firmware **jangan** mengirim nilai itu; nilai di luar
rentang membuat *seluruh pesan* ditolak. Opsi yang disarankan: kirim pesan tanpa pack tersebut, atau kirim nilai valid
terakhir sambil menandai fault lewat mekanisme yang akan didefinisikan (di luar cakupan v1).

## 3. Timestamp (semantik waktu)

Keputusan: **jam device tidak dipercaya penuh** (belum dipastikan firmware sinkron NTP/RTC).

1. Backend mencatat `receivedAt` = waktu server saat pesan diterima (UTC).
2. `recordedAt` (waktu yang dipakai untuk grafik/urutan):
   - jika `|timestamp − receivedAt| ≤ 5 menit` → `recordedAt = timestamp` (jam device);
   - selain itu (jam belum sinkron, `millis()` sejak boot, tahun 1970, atau jauh di masa depan) → `recordedAt = receivedAt`.
3. Semua API mengekspos waktu sebagai ISO-8601 UTC. `receivedAt` selalu tersedia; selisih `receivedAt − recordedAt` menunjukkan
   data buffer/jam menyimpang.

**Dampak firmware:** disarankan sinkron NTP saat boot dan mengirim `timestamp` = `time(NULL) * 1000`. Bila tidak bisa, kirim
`timestamp` apa adanya; backend menangani.

## 4. Perilaku backend (idempotensi, urutan, batas)

| Topik | Perilaku |
|---|---|
| Validasi | Payload divalidasi zod. Yang gagal **dibuang** (tidak disimpan, tidak di-broadcast), dihitung di counter `mqtt.invalid*` dan dicatat sebagai log JSON `mqtt.invalid_payload` (dibatasi 1 log/10 dtk per device+alasan; isi payload tidak dicatat). |
| Auto-provision | Serial baru otomatis dibuat sebagai `Device` tanpa owner (`verified=false`). Diklaim lewat aplikasi/web. |
| Idempotensi | Riwayat unik per `(deviceId, packIndex, recordedAt)` (+ `cellIndex` untuk cell). Pesan duplikat (mis. redelivery QoS 1) diabaikan. **Batasan:** bila jam device menyimpang dan `recordedAt` diganti waktu server, redelivery mendapat `receivedAt` berbeda sehingga *bisa* tersimpan ganda. Mitigasi jangka panjang: field `seq` monotonik dari firmware (belum di kontrak). |
| Urutan | State "terbaru" (`Pack`/`Cell`) **tidak ditimpa** oleh pesan dengan `recordedAt` lebih lama dari yang sudah tersimpan. Riwayat tetap menyimpan semuanya. |
| Backpressure | Antrean bounded per device; bila penuh, pesan paling lama dibuang dan dihitung `mqtt.dropped`. |
| Laju yang disarankan | ≥ 1 pesan/detik per device masih aman; default simulator 1 pesan/60 detik. |

## 5. Autentikasi & otorisasi broker

Saat ini satu akun bersama; **rencana**: user per device (`username = device_id`) + `acl_file`
(`pattern write bms/%u/#`) dan user `backend` read-only `bms/#`, TLS di port 8883. Perubahan ini butuh provisioning kredensial
per unit di firmware (NVS). Akan dikerjakan bersama perbaikan `MQTT/` (F-05/F-25).

## 6. Rencana perubahan kontrak (belum aktif)

| Perubahan | Dampak |
|---|---|
| Topik `bms/{id}/status` retained + LWT `offline` (payload `{"state":"online"\|"offline"}`) | **firmware + mqtt + backend + mobile/FE** (indikator online/offline akurat) |
| Field opsional `seq` (integer naik monoton per boot) | firmware + backend (dedupe andal saat jam menyimpang) |
| Kredensial per device + ACL + TLS | firmware + mqtt + backend |

## 7. Ringkasan dampak perubahan pada Fase A

| Perubahan | Firmware | Backend | FE/Mobile |
|---|---|---|---|
| Payload invalid kini ditolak (rentang, ukuran, duplikat index) | **Cek**: pesan yang dulu lolos bisa ditolak | ya | — |
| Semantik `timestamp` (§3) | Disarankan NTP | ya | Waktu ISO-8601 UTC dari API |
| Batas 64 KiB / 16 pack / 64 cell | **Cek** | ya | — |
