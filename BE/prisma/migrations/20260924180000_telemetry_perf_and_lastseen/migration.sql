-- Freshness: waktu server terakhir menerima paket MQTT per device (dipakai FE getFreshness).
ALTER TABLE "Device" ADD COLUMN "lastSeen" TIMESTAMP(3);

-- Catatan integrasi: migrasi ini semula juga membuat index
-- "PackHistory_deviceId_recordedAt_idx" dan "CellHistory_deviceId_recordedAt_idx" untuk query
-- history/agregasi per device+rentang waktu. Index yang SAMA PERSIS sudah dibuat oleh migrasi
-- feat/mobile-api-v1 "20260921140000_history_current_power_and_indexes" (yang lebih dulu di
-- urutan migrasi ini) — dihapus dari sini agar tidak duplikat (nama index akan bentrok bila
-- dijalankan ulang). Lihat docs/REDESIGN_PROGRESS.md §8 untuk detail rekonsiliasi migration.
