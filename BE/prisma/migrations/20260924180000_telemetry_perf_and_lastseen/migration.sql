-- Freshness: waktu server terakhir menerima paket MQTT per device.
ALTER TABLE "Device" ADD COLUMN "lastSeen" TIMESTAMP(3);

-- Index untuk query history/agregasi yang memfilter per device + rentang waktu
-- (index komposit lama diawali packIndex/cellIndex sehingga tak terpakai untuk filter ini).
CREATE INDEX "PackHistory_deviceId_recordedAt_idx" ON "PackHistory"("deviceId", "recordedAt");
CREATE INDEX "CellHistory_deviceId_recordedAt_idx" ON "CellHistory"("deviceId", "recordedAt");
