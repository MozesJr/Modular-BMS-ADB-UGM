-- Additive: tidak menghapus/mengubah data. Kolom baru nullable (baris lama = NULL).
-- CATATAN OPERASIONAL: CREATE INDEX biasa mengunci TULIS pada tabel terkait selama pembuatan;
-- pada tabel history besar jalankan saat trafik rendah.
-- AlterTable
ALTER TABLE "PackHistory" ADD COLUMN     "current" DOUBLE PRECISION,
ADD COLUMN     "power" DOUBLE PRECISION;
-- CreateIndex
CREATE INDEX "Device_ownerId_idx" ON "Device"("ownerId");
-- CreateIndex
CREATE INDEX "DeviceCollaborator_userId_idx" ON "DeviceCollaborator"("userId");
-- CreateIndex
CREATE INDEX "PackHistory_deviceId_recordedAt_idx" ON "PackHistory"("deviceId", "recordedAt");
-- CreateIndex
CREATE INDEX "CellHistory_deviceId_recordedAt_idx" ON "CellHistory"("deviceId", "recordedAt");
