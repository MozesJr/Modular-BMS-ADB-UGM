-- Idempotensi ingestion + jaminan urutan "latest state" (audit F-12).
--
-- CATATAN OPERASIONAL:
--  * Langkah DELETE di bawah membuang baris history DUPLIKAT (sama deviceId/packIndex[/cellIndex]/recordedAt),
--    menyisakan satu (id terkecil). Wajib sebelum membuat unique index, kalau tidak migrasi gagal.
--  * CREATE UNIQUE INDEX non-CONCURRENTLY mengunci tulis tabel history selama pembuatan index.
--    Jalankan saat trafik rendah (Prisma menjalankan migrasi dalam transaksi sehingga tidak bisa CONCURRENTLY).

-- AlterTable: waktu data + waktu terima pada state terbaru
ALTER TABLE "Pack" ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "recordedAt" TIMESTAMP(3);

-- AlterTable: waktu terima pada history (baris lama = NULL)
ALTER TABLE "PackHistory" ADD COLUMN     "receivedAt" TIMESTAMP(3);

-- Hapus duplikat yang mungkin sudah ada
DELETE FROM "PackHistory" a
USING "PackHistory" b
WHERE a."id" > b."id"
  AND a."deviceId" = b."deviceId"
  AND a."packIndex" = b."packIndex"
  AND a."recordedAt" = b."recordedAt";

DELETE FROM "CellHistory" a
USING "CellHistory" b
WHERE a."id" > b."id"
  AND a."deviceId" = b."deviceId"
  AND a."packIndex" = b."packIndex"
  AND a."cellIndex" = b."cellIndex"
  AND a."recordedAt" = b."recordedAt";

-- CreateIndex (unique; prefix-nya juga melayani query per deviceId+packIndex)
CREATE UNIQUE INDEX "PackHistory_deviceId_packIndex_recordedAt_key" ON "PackHistory"("deviceId", "packIndex", "recordedAt");

CREATE UNIQUE INDEX "CellHistory_deviceId_packIndex_cellIndex_recordedAt_key" ON "CellHistory"("deviceId", "packIndex", "cellIndex", "recordedAt");

-- DropIndex: digantikan oleh unique index di atas
DROP INDEX "PackHistory_deviceId_packIndex_recordedAt_idx";

DROP INDEX "CellHistory_deviceId_packIndex_cellIndex_recordedAt_idx";
