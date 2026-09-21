-- Rollup 1 menit untuk riwayat jangka panjang (raw dipangkas 30 hari oleh scripts/retention.ts). Additive: tabel baru, kosong sampai skrip dijalankan.
-- CreateTable
CREATE TABLE "PackRollup1m" (
    "deviceId" TEXT NOT NULL,
    "packIndex" INTEGER NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "samples" INTEGER NOT NULL,
    "tempAvg" DOUBLE PRECISION,
    "tempMin" DOUBLE PRECISION,
    "tempMax" DOUBLE PRECISION,
    "tempCount" INTEGER NOT NULL DEFAULT 0,
    "currentAvg" DOUBLE PRECISION,
    "currentMin" DOUBLE PRECISION,
    "currentMax" DOUBLE PRECISION,
    "currentCount" INTEGER NOT NULL DEFAULT 0,
    "powerAvg" DOUBLE PRECISION,
    "powerMin" DOUBLE PRECISION,
    "powerMax" DOUBLE PRECISION,
    "powerCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PackRollup1m_pkey" PRIMARY KEY ("deviceId","packIndex","bucketStart")
);
-- CreateTable
CREATE TABLE "CellRollup1m" (
    "deviceId" TEXT NOT NULL,
    "packIndex" INTEGER NOT NULL,
    "cellIndex" INTEGER NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "samples" INTEGER NOT NULL,
    "vAvg" DOUBLE PRECISION NOT NULL,
    "vMin" DOUBLE PRECISION NOT NULL,
    "vMax" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "CellRollup1m_pkey" PRIMARY KEY ("deviceId","packIndex","cellIndex","bucketStart")
);
-- AddForeignKey
ALTER TABLE "PackRollup1m" ADD CONSTRAINT "PackRollup1m_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CellRollup1m" ADD CONSTRAINT "CellRollup1m_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
