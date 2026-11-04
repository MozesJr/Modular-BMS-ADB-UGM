-- SoC / kapasitas / status balancing dari coulomb counter BMS (JK-BMS). Additive & nullable:
-- baris lama tetap utuh (NULL), tidak ada backfill, tidak ada DROP/RESET.
-- Pack.temperature & PackHistory.temperature sudah nullable sejak awal (tidak diubah).

-- AlterTable
ALTER TABLE "Pack" ADD COLUMN     "soc" DOUBLE PRECISION,
ADD COLUMN     "remainingCapacity" DOUBLE PRECISION,
ADD COLUMN     "capacity" DOUBLE PRECISION,
ADD COLUMN     "balancing" BOOLEAN;

-- AlterTable
ALTER TABLE "PackHistory" ADD COLUMN     "soc" DOUBLE PRECISION,
ADD COLUMN     "remainingCapacity" DOUBLE PRECISION,
ADD COLUMN     "capacity" DOUBLE PRECISION,
ADD COLUMN     "balancing" BOOLEAN;

-- AlterTable (rollup 1 menit: SoC supaya tren SoC tetap ada setelah raw dipangkas)
ALTER TABLE "PackRollup1m" ADD COLUMN     "socAvg" DOUBLE PRECISION,
ADD COLUMN     "socMin" DOUBLE PRECISION,
ADD COLUMN     "socMax" DOUBLE PRECISION,
ADD COLUMN     "socCount" INTEGER NOT NULL DEFAULT 0;
