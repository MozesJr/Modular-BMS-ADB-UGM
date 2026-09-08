-- AlterTable: pisahkan "device_id" fisik (dari topik MQTT) dari primary key Device.id
-- Device.id lama dipakai manual sbg ID fisik device, jadi backfill serialNumber = id
-- biar data existing gak hilang. Device.id baru selanjutnya di-generate otomatis (cuid).
ALTER TABLE "Device" ADD COLUMN "serialNumber" TEXT;
UPDATE "Device" SET "serialNumber" = "id" WHERE "serialNumber" IS NULL;
ALTER TABLE "Device" ALTER COLUMN "serialNumber" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Device_serialNumber_key" ON "Device"("serialNumber");

-- AlterTable: ownerId jadi nullable — device bisa "auto-provisioned" dari ingestion MQTT
-- sebelum diklaim/didaftarin user manapun. Verifikasi/ownership dipisah dari ingestion.
ALTER TABLE "Device" DROP CONSTRAINT "Device_ownerId_fkey";
ALTER TABLE "Device" ALTER COLUMN "ownerId" DROP NOT NULL;
ALTER TABLE "Device" ADD CONSTRAINT "Device_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: Pack & Cell jadi tabel "latest state" — unique constraint dipakai buat upsert
-- tiap message MQTT masuk (satu row per index per parent, bukan history).
CREATE UNIQUE INDEX "Pack_deviceId_index_key" ON "Pack"("deviceId", "index");
CREATE UNIQUE INDEX "Cell_packId_index_key" ON "Cell"("packId", "index");

-- CreateTable
CREATE TABLE "PackHistory" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "packIndex" INTEGER NOT NULL,
    "temperature" DOUBLE PRECISION,
    "balancerConnected" BOOLEAN NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CellHistory" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "packIndex" INTEGER NOT NULL,
    "cellIndex" INTEGER NOT NULL,
    "voltage" DOUBLE PRECISION NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CellHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PackHistory_deviceId_packIndex_recordedAt_idx" ON "PackHistory"("deviceId", "packIndex", "recordedAt");

-- CreateIndex
CREATE INDEX "CellHistory_deviceId_packIndex_cellIndex_recordedAt_idx" ON "CellHistory"("deviceId", "packIndex", "cellIndex", "recordedAt");

-- AddForeignKey
ALTER TABLE "PackHistory" ADD CONSTRAINT "PackHistory_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CellHistory" ADD CONSTRAINT "CellHistory_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
