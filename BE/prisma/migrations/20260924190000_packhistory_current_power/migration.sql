-- Arus & daya historis per pack (nullable; device lama tak mengirimnya).
ALTER TABLE "PackHistory" ADD COLUMN "current" DOUBLE PRECISION;
ALTER TABLE "PackHistory" ADD COLUMN "power" DOUBLE PRECISION;
