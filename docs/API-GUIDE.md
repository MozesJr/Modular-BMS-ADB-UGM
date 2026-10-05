# Panduan API v1 — untuk pengembang aplikasi mobile

Kontrak mesin-baca: [`openapi.json`](./openapi.json) (OpenAPI 3.0.3, dihasilkan dari skema zod di `BE/src/contracts/`; CI gagal bila tidak sinkron).
Dokumen ini menjelaskan **cara memakainya**: alur auth, penyimpanan token, pagination, ETag, riwayat, peran, error.

> **Cakupan saat ini (Gelombang 1):** auth token, profil, device, dashboard, riwayat, collaborator. **Belum ada** (menyusul di Gelombang 2):
> WebSocket realtime, daftar/ack alert, registrasi device token push (FCM), indikator online berbasis LWT. Sampai saat itu gunakan
> polling ringan + ETag (§7). Tidak ada **SoC/SoH** di API mana pun: perangkat belum mengirimnya.

---

## 1. Dasar

| Hal | Aturan |
|---|---|
| Base URL | `https://<host>/api/v1` (HTTPS **wajib** untuk build rilis; HTTP polos ditolak OS). `GET /api/health` di luar versi. |
| Format | JSON UTF-8. `Content-Type: application/json` pada request ber-body. |
| Auth | `Authorization: Bearer <accessToken>` pada semua endpoint kecuali `auth/login`, `auth/refresh`, `auth/logout`, `health`. |
| Waktu | **Selalu ISO-8601 UTC**, mis. `2026-09-21T08:15:00.000Z`. Parse sebagai UTC; tampilkan dalam zona lokal di UI. |
| Satuan | Ada di **nama field**: `voltageV` (V), `currentA` (A), `powerW` (W), `temperatureC` (°C), `cellDeltaMv` (mV). |
| Tanda arus | `currentA` **negatif = charging**, positif = discharging. `powerW` mengikuti tanda yang sama (`V × A`). |
| Null | `temperatureC: null` = **sensor error / tidak ada pembacaan** (tampilkan "Error"/"–", bukan 0). Field null lain = data belum ada. |
| Request ID | Setiap respons membawa header `X-Request-Id` (juga di body error). Sertakan saat melapor masalah. Anda boleh mengirim `X-Request-Id` sendiri (8–64 karakter `[A-Za-z0-9._-]`). |
| Kompatibilitas | Penambahan field/endpoint bersifat **aditif** di v1. Klien harus **mengabaikan field yang tidak dikenal** dan tidak crash pada nilai enum baru. Perubahan yang memecahkan kompatibilitas = `/api/v2`. |

### Bentuk error (seragam)
```json
{ "error": { "code": "DEVICE_NOT_FOUND", "message": "Device tidak ditemukan", "details": [ { "path": "metrics", "message": "…" } ] },
  "requestId": "3f6c…" }
```
`details` hanya ada pada `VALIDATION_ERROR` (daftar isu per field). **Mem-branch pada `code` (stabil), jangan pada `message`** (bahasa Indonesia, bisa berubah).

| HTTP | `code` | Arti / tindakan klien |
|---|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_JSON`, `INVALID_CURSOR` | Perbaiki request. `INVALID_CURSOR`: mulai lagi dari halaman pertama. |
| 401 | `UNAUTHORIZED` | Access token hilang/kedaluwarsa/dicabut → coba **refresh** sekali (§2); gagal → login ulang. |
| 401 | `INVALID_CREDENTIALS` | Email/password salah (pesan sama untuk email tak terdaftar). |
| 401 | `INVALID_REFRESH_TOKEN`, `REFRESH_EXPIRED`, `REFRESH_REVOKED`, `REFRESH_REUSED`, `SESSION_REVOKED` | Sesi berakhir → **hapus token lokal, minta login ulang**. Tidak ada gunanya mencoba lagi. |
| 403 | `ACCOUNT_EXPIRED` | Masa berlaku akun habis (hubungi admin). |
| 403 | `FORBIDDEN` | Anggota device tapi peran kurang (mis. viewer mencoba ubah nama). |
| 404 | `DEVICE_NOT_FOUND`, `USER_NOT_FOUND`, `COLLABORATOR_NOT_FOUND` | **Bukan anggota device = `DEVICE_NOT_FOUND`** (sengaja sama dengan "tidak ada"). |
| 409 | `DEVICE_ALREADY_CLAIMED`, `ALREADY_COLLABORATOR`, `CONFLICT` | Bentrok dengan keadaan saat ini. |
| 413 | `PAYLOAD_TOO_LARGE` | Body > 64 KiB. |
| 429 | `RATE_LIMITED` | Tunggu sesuai header **`Retry-After`** (detik). |
| 500 | `INTERNAL` | Kesalahan server; coba lagi dengan backoff, lapor `requestId` bila berulang. |

---

## 2. Autentikasi (token)

Alur: **login → access token (JWT ±15 menit) + refresh token (opaque, 30 hari, sekali pakai)** → refresh berotasi → logout.
Web tetap memakai cookie Auth.js; token ini khusus klien native.

```
POST /api/v1/auth/login    { "email", "password", "deviceName?" }      → TokenResponse
POST /api/v1/auth/refresh  { "refreshToken" }                          → TokenResponse (pasangan BARU)
POST /api/v1/auth/logout   { "refreshToken" }                          → 204 (sesi perangkat ini dicabut)
POST /api/v1/auth/logout-all  (Bearer)                                 → 204 (semua perangkat + web dicabut)
```
`TokenResponse`: `accessToken`, `refreshToken`, `tokenType:"Bearer"`, `expiresIn` (detik, 900), `refreshExpiresIn` (detik, ≤ 2.592.000), `user`.

### Penyimpanan token (wajib diikuti)
| Token | Simpan di | Jangan |
|---|---|---|
| Access token | **Memori proses saja** | disk, log, analytics, crash report |
| Refresh token | **Keychain (iOS) / Keystore (Android)** — Flutter: `flutter_secure_storage`; RN/Expo: `expo-secure-store` | SharedPreferences/AsyncStorage/file biasa, log |
| Password | tidak disimpan sama sekali | — |

### Aturan refresh (penting karena rotasi + deteksi reuse)
1. Kirim refresh saat access token **kedaluwarsa** (respons 401 `UNAUTHORIZED`) atau proaktif ±60 detik sebelum `expiresIn` habis.
2. **Single-flight:** jangan pernah menjalankan dua refresh serentak. Antrekan semua request yang menunggu, satu refresh, lalu ulangi semuanya dengan token baru.
3. **Simpan refresh token BARU (atomik) sebelum memakai access token baru.** Refresh token lama sudah mati begitu refresh berhasil.
4. **Jangan retry buta.** Jika respons refresh hilang (jaringan putus) dan Anda mengirim ulang token lama, server melihat *reuse* → `REFRESH_REUSED` → **seluruh sesi perangkat itu dicabut** dan pengguna harus login ulang. Bila ragu apakah refresh berhasil, perlakukan sebagai sesi berakhir (login ulang) — itu lebih aman daripada mencoba lagi.
5. Untuk semua kode 401 pada `/auth/refresh` (lihat tabel): hapus token, tampilkan layar login.
6. Batas: refresh dan logout dibatasi **60 permintaan/15 menit per IP**; login **10/15 menit per akun** dan **30/15 menit per IP**.

Pseudocode interceptor (bahasa apa pun):
```
request(req):  req.headers.Authorization = "Bearer " + memory.accessToken
response(res): if res.status == 401 and res.error.code == "UNAUTHORIZED" and not req.retried:
                   ok = await singleFlight(refreshSession)     // satu refresh untuk semua peminta
                   if ok: return retry(req with new token, retried=true)
                   else:  goToLogin()
refreshSession(): old = secureStore.read("refresh"); r = POST /auth/refresh {old}
                  if r.ok: secureStore.write("refresh", r.refreshToken); memory.accessToken = r.accessToken; return true
                  else:    secureStore.delete("refresh"); memory.accessToken = null; return false
```

### Logout
* **Logout perangkat ini:** `POST /auth/logout` dengan refresh token, lalu hapus token lokal. Access token yang sudah terbit **tetap sah sampai kedaluwarsa (≤ 15 menit)** — buang dari memori.
* **Logout semua perangkat:** `POST /auth/logout-all`. Semua access token (mobile) dan sesi web berhenti berlaku **seketika**.
* Ganti/reset password atau admin mengubah password juga mencabut semua sesi.
* Akun yang diberi masa berlaku dan sudah lewat: request dengan access token yang masih segar pun langsung ditolak (`UNAUTHORIZED`).

---

## 3. Device & dashboard

| Endpoint | Fungsi |
|---|---|
| `GET /me` | Profil (`id, email, name, role, expiresAt`). |
| `GET /devices?view=summary\|basic&limit=1..100&cursor=` | Daftar device (owner **atau** collaborator), terbaru dulu. |
| `GET /devices/{id}` | Snapshot lengkap: pack, cell, ringkasan, collaborator. |
| `GET /dashboard/summary` | Ringkasan lintas device: jumlah online/offline/menunggu verifikasi, total daya, suhu maks, delta cell maks. |
| `POST /devices` | Daftarkan/klaim device dengan `serialNumber`. |

**`online`** = server menerima data dalam **180 detik** terakhir; `lastSeenAt` = waktu server menerima data terakhir (bukan jam perangkat).
Nilai dashboard (daya, suhu, delta) dihitung **dari device online saja**; kosong = `null` (bukan 0).
Tegangan pack = jumlah tegangan seluruh cell pack. `cellDeltaMv` = cell tertinggi − terendah. Selain itu **tidak ada SoC/SoH**.

### Pagination (cursor)
```
GET /devices?limit=20                → { "items": [...], "nextCursor": "eyJj…" }
GET /devices?limit=20&cursor=eyJj…   → halaman berikutnya
```
`nextCursor: null` = habis. Perlakukan cursor sebagai string **buram** (jangan parse/bangun sendiri). `INVALID_CURSOR` (400) → ulang dari awal.

### Daftar vs detail
`view=summary` (default) menyertakan `summary` per device (tegangan, arus, daya, suhu, delta per pack) — cukup untuk kartu daftar tanpa memanggil detail. Pakai `view=basic` bila hanya butuh identitas + `online`.

---

## 4. Riwayat (time-series)

```
GET /devices/{id}/history?from=&to=&bucket=raw|1m|5m|1h&metrics=temperature,current,power,voltage&packIndex=&limit=&cursor=
```
Respons: `series[]`, tiap seri = `{ scope: pack|cell, packIndex, cellIndex|null, metric, unit, points:[{t, v, min, max}] }`.
`v` = nilai (raw) atau **rata-rata bucket**; `min`/`max` hanya untuk bucket agregat (raw: `null`). Bucket tanpa sampel **tidak muncul** (jangan asumsikan titik rapat — gambar celah).

| Metrik | Level | Satuan |
|---|---|---|
| `temperature`, `current`, `power` | per **pack** | °C, A, W |
| `voltage` | per **cell** (banyak seri) | V |

**Default:** 24 jam terakhir, `bucket=5m`, metrics `temperature,current,power`. `voltage` harus diminta eksplisit.

### Memilih bucket
| Rentang tampilan | Bucket | Titik/seri (kira-kira) |
|---|---|---|
| ≤ 1 jam | `raw` atau `1m` | 60 |
| ≤ 6 jam | `1m` | 360 |
| 6–48 jam | `5m` | ≤ 576 |
| 2–30 hari | `1h` | ≤ 720 |
| > 30 hari | `1h` (hanya agregat tersedia) | — |

* **Batas titik:** total titik semua seri ≤ ~**20.000**. Lebih dari itu → `400 VALIDATION_ERROR` dengan saran (bucket lebih besar, rentang lebih pendek, atau `packIndex`/`metrics` lebih sempit). Ini terjadi terutama pada `voltage` (jumlah seri = jumlah cell).
* **`raw`:** rentang maks **48 jam**; `voltage` **tidak boleh** digabung dengan metrik pack dalam satu request raw; halaman berikutnya lewat `nextCursor` → `?cursor=` (jangan ubah parameter lain di antara halaman).
* **Retensi:** sampel raw disimpan **30 hari**; lebih lama hanya tersedia sebagai agregat 1 menit (bucket `1m/5m/1h` tetap bekerja untuk rentang lama).
* Suhu `null` (sensor error) tidak menghasilkan titik.

---

## 5. Peran & hak

| Aksi | viewer | editor | owner |
|---|:-:|:-:|:-:|
| Lihat device, riwayat, collaborator | ✔ | ✔ | ✔ |
| Melihat **email** collaborator | ✘ (null) | ✘ (null) | ✔ |
| Ubah nama device (`PATCH /devices/{id}`) | ✘ | ✔ | ✔ |
| Undang / ubah peran / cabut collaborator | ✘ | ✘ | ✔ |
| Keluar sendiri (`DELETE …/collaborators/{ownUserId}`) | ✔ | ✔ | — |
| Lepas (unclaim) atau hapus device | ✘ | ✘ | ✔ |
| Ack alert (Gelombang 2) | ✘ | ✔ | ✔ |

* Non-anggota selalu `404 DEVICE_NOT_FOUND`; anggota dengan peran kurang `403 FORBIDDEN`.
* `role` pada tiap device di respons = peran **user yang sedang login** (`owner|editor|viewer`) — gunakan untuk menyembunyikan tombol yang tidak berlaku.
* **Unclaim** (`DELETE /devices/{id}`, default): data tetap, nama dikosongkan, `verified` kembali false, semua collaborator dilepas. **Hapus permanen:** `?mode=delete&confirmSerial=<serialNumber>` (riwayat ikut terhapus).
* Klaim device: `serialNumber` hanya `[A-Za-z0-9._-]`, maks 64. Device baru `verified=false` sampai admin menyetujui. Batas 20 klaim/jam per user; undangan collaborator 30/jam.

---

## 6. ETag & cache (hemat data/baterai, dukungan offline)

Endpoint baca (`/me`, `/devices`, `/devices/{id}`, `/dashboard/summary`, `/devices/{id}/history`) mengirim `ETag` dan
`Cache-Control: private, no-cache` (boleh disimpan, **wajib revalidasi**).

```
GET /devices/abc            →  200  ETag: W/"K3x…"        (simpan body + ETag)
GET /devices/abc  If-None-Match: W/"K3x…"  →  304 (tanpa body)   → pakai salinan lokal
```
* Sertakan `If-None-Match` dengan ETag terakhir; **304 berarti data sama** (murah). Banyak HTTP client (dio cache interceptor, URLSession) melakukan ini otomatis.
* Simpan **salinan terakhir + waktu terakhir sukses** per resource. Saat offline/gagal, tampilkan salinan dengan banner **"Data lama (n menit)"** dan tanda "tidak terhubung", jangan layar kosong.
* Aksi tulis (rename, undang, dll.) sebaiknya **tidak** diantrekan diam-diam saat offline tanpa memberi tahu pengguna; tidak ada `Idempotency-Key` di v1.
* ETag dashboard tidak memasukkan `generatedAt`; ETag riwayat dihitung dari isi seri.

## 7. Realtime (sementara: polling)

WebSocket dan push menyusul di Gelombang 2. Sementara, **hanya saat layar terlihat (foreground)**:

| Layar | Interval polling | Catatan |
|---|---|---|
| Dashboard / daftar device | 30 detik | `If-None-Match` → 304 murah |
| Detail device (live) | 10–15 detik | berhenti saat app ke background |
| Riwayat | sekali saat dibuka + tarik-untuk-segarkan | jangan polling grafik |

Hentikan timer saat app background (`AppLifecycleState.paused`), lanjut saat foreground. Perangkat mengirim tiap ±60 detik, jadi polling < 10 detik tidak menambah informasi.

---

## 8. Batas laju

| Endpoint | Batas |
|---|---|
| `POST /auth/login` | 10 / 15 menit per akun, 30 / 15 menit per IP |
| `POST /auth/refresh`, `/auth/logout` | 60 / 15 menit per IP |
| `POST /devices` (klaim) | 20 / jam per user |
| `POST /devices/{id}/collaborators` | 30 / jam per user |

Melebihi batas → `429 RATE_LIMITED` + header `Retry-After` (detik). Backoff eksponensial dengan jitter untuk `500`.

## 9. Membuat klien dari OpenAPI

Dokumen dirancang **sederhana untuk generator** (lint di CI melarang `oneOf/anyOf/allOf`, tipe array gaya 3.1, dan `nullable` pada objek `$ref`):
```bash
# Dart (dio), contoh — versi generator sesuai kebutuhan tim
openapi-generator-cli generate -i docs/openapi.json -g dart-dio -o mobile_api_client
# TypeScript (dipakai FE web):  npx openapi-typescript docs/openapi.json -o api.d.ts
```
Field `nullable` berarti kunci **selalu ada** namun bisa `null`; field opsional (`?`) bisa tidak ada. Enum baru bisa muncul di versi minor — sediakan cabang "unknown" pada deserialisasi.
Bila skema berubah: backend menjalankan `cd BE && npm run openapi` dan commit `docs/openapi.json` (CI `openapi:check` gagal bila lupa). Anda cukup meng-generate ulang klien.

## 10. Uji lokal & smoke test

```bash
cd BE && npm run smoke:api        # 126 pemeriksaan end-to-end (login → devices → history → refresh/reuse → logout → collaborator …)
```
Menyalakan Postgres **sekali-pakai** di Docker + server BE sendiri, menyemai data, memvalidasi setiap respons terhadap skema kontrak yang sama dengan OpenAPI. Tidak menyentuh DB/server lain (butuh Docker).

Contoh manual (`$T` = access token):
```bash
curl -s https://<host>/api/v1/auth/login -H 'content-type: application/json' \
     -d '{"email":"user@example.com","password":"***","deviceName":"Pixel 8"}'
curl -s https://<host>/api/v1/devices?limit=20 -H "authorization: Bearer $T"
curl -s "https://<host>/api/v1/devices/<id>/history?bucket=5m&metrics=power" -H "authorization: Bearer $T"
```

## 11. Daftar periksa keamanan klien
- [ ] HTTPS saja; jangan menonaktifkan validasi sertifikat (pin sertifikat opsional).
- [ ] Access token hanya di memori; refresh token hanya di Keychain/Keystore.
- [ ] Jangan mencatat header `Authorization`, body login/refresh, atau token ke log/analytics/crash report.
- [ ] Hapus semua token saat logout dan saat menerima kode sesi-berakhir (§1).
- [ ] Refresh single-flight; jangan retry refresh yang responsnya tidak diketahui (§2).
- [ ] Tampilkan `temperatureC: null` sebagai "sensor error", bukan 0 °C.
- [ ] Jangan menampilkan SoC/SoH atau angka turunan yang tidak ada di API.
