-- DropForeignKey
ALTER TABLE "Cell" DROP CONSTRAINT "Cell_packId_fkey";

-- DropForeignKey
ALTER TABLE "Pack" DROP CONSTRAINT "Pack_deviceId_fkey";

-- AddForeignKey
ALTER TABLE "Pack" ADD CONSTRAINT "Pack_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cell" ADD CONSTRAINT "Cell_packId_fkey" FOREIGN KEY ("packId") REFERENCES "Pack"("id") ON DELETE CASCADE ON UPDATE CASCADE;
