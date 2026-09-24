import mqtt, { MqttClient } from "mqtt";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { broadcast } from "@/lib/ws";
import type { BmsDevicePayload } from "@/types/bms";

let client: MqttClient | null = null;

// Cache id device & pack per serialNumber supaya pesan berikutnya tak perlu query lookup —
// hanya insert reading. Di-reset per proses (aman: tsx watch / restart bikin cache baru).
type DeviceEntry = { deviceId: string; packIds: Map<number, string> };
const deviceCache = new Map<string, DeviceEntry>();

// Antrian serial per device: pesan satu device diproses berurutan supaya koneksi DB tidak
// menumpuk saat throughput tinggi / latency DB naik. Backlog dibatasi (pesan terbaru lebih
// berharga daripada yang basi) — kalau penuh, pesan di-drop.
const queues = new Map<string, Promise<void>>();
const backlog = new Map<string, number>();
const MAX_BACKLOG = 5;

function enqueue(serialNumber: string, task: () => Promise<void>) {
  const current = backlog.get(serialNumber) ?? 0;
  if (current >= MAX_BACKLOG) {
    console.warn(`[mqtt] backlog penuh untuk ${serialNumber} (${current}) — pesan di-drop`);
    return;
  }
  backlog.set(serialNumber, current + 1);
  const prev = queues.get(serialNumber) ?? Promise.resolve();
  const next = prev
    .then(task)
    .catch((err) => {
      console.error("[mqtt] gagal memproses pesan", serialNumber, err);
      // Cache mungkin basi (device/pack berubah) → paksa re-ensure di pesan berikutnya.
      deviceCache.delete(serialNumber);
    })
    .finally(() => {
      backlog.set(serialNumber, Math.max(0, (backlog.get(serialNumber) ?? 1) - 1));
    });
  queues.set(serialNumber, next);
}

export function registerMqttSubscriber() {
  if (client) return client; // guard: cegah subscribe dobel saat hot-reload dev

  const brokerUrl = process.env.MQTT_BROKER_URL ?? "mqtt://mqtt:1883";

  client = mqtt.connect(brokerUrl, {
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    clientId: `bms-backend-${Math.random().toString(16).slice(2)}`,
    reconnectPeriod: 2000,
  });

  client.on("connect", () => {
    console.log("[mqtt] connected");
    client!.subscribe("bms/+/data", { qos: 1 }, (err, granted) => {
      if (err) console.error("[mqtt] subscribe error", err);
      else console.log("[mqtt] subscribed", (granted ?? []).map((g) => `${g.topic} (qos ${g.qos})`).join(", "));
    });
  });

  client.on("message", (topic, payloadBuf) => {
    // device_id di topik ("bms/{device_id}/data") = Device.serialNumber, BUKAN Device.id (PK).
    const mqttDeviceId = topic.split("/")[1];
    if (!mqttDeviceId) return;

    let payload: BmsDevicePayload;
    try {
      payload = JSON.parse(payloadBuf.toString());
    } catch (err) {
      console.error("[mqtt] payload bukan JSON valid", topic, err);
      return;
    }

    // Antre per device — parsing sudah selesai (sinkron), persist berjalan async berurutan.
    enqueue(mqttDeviceId, async () => {
      const deviceId = await persistPayload(mqttDeviceId, payload);
      broadcast("bms:update", { id: deviceId, serialNumber: mqttDeviceId, ...payload });
    });
  });

  client.on("error", (err) => console.error("[mqtt] error", err));
  client.on("reconnect", () => console.log("[mqtt] reconnecting..."));
  client.on("close", () => console.log("[mqtt] connection closed"));
  client.on("offline", () => console.log("[mqtt] client offline"));

  return client;
}

// Pastikan device + semua pack di payload punya row & id ter-cache. Query DB hanya saat
// cache miss (device baru) atau ada pack index baru (jarang) — steady-state 0 query di sini.
async function ensureDeviceAndPacks(
  serialNumber: string,
  payload: BmsDevicePayload,
): Promise<DeviceEntry> {
  let entry = deviceCache.get(serialNumber);

  if (!entry) {
    const device = await prisma.device.upsert({
      where: { serialNumber },
      create: { serialNumber },
      update: {},
      select: { id: true },
    });
    const packs = await prisma.pack.findMany({
      where: { deviceId: device.id },
      select: { id: true, index: true },
    });
    entry = { deviceId: device.id, packIds: new Map(packs.map((p) => [p.index, p.id])) };
    deviceCache.set(serialNumber, entry);
  }

  // Buat pack yang belum ada (mis. jumlah pack device bertambah).
  for (const pack of payload.packs) {
    if (!entry.packIds.has(pack.index)) {
      const created = await prisma.pack.upsert({
        where: { deviceId_index: { deviceId: entry.deviceId, index: pack.index } },
        create: { deviceId: entry.deviceId, index: pack.index },
        update: {},
        select: { id: true },
      });
      entry.packIds.set(pack.index, created.id);
    }
  }

  return entry;
}

// Simpan payload MQTT dengan round-trip minimal:
//   1x ensure (0 saat cache hit) + 1 batch $transaction berisi:
//     - update lastSeen device
//     - upsert multi-row latest-state Pack  (1 statement)
//     - upsert multi-row latest-state Cell  (1 statement)
//     - createMany PackHistory / CellHistory
// Semua atomik. Cell/Pack upsert pakai raw ON CONFLICT karena kontrak payload dinamis
// (jumlah cell bervariasi) dan loop upsert = 1 round-trip per cell (penyebab lama P2028).
async function persistPayload(mqttDeviceId: string, payload: BmsDevicePayload): Promise<string> {
  const { deviceId, packIds } = await ensureDeviceAndPacks(mqttDeviceId, payload);
  const recordedAt = new Date(payload.timestamp); // waktu firmware — untuk history
  const persistedAt = new Date(); // waktu server menerima — untuk lastSeen & updatedAt latest-state

  const packValues: Prisma.Sql[] = [];
  const cellValues: Prisma.Sql[] = [];
  const packHistoryRows: Prisma.PackHistoryCreateManyInput[] = [];
  const cellHistoryRows: Prisma.CellHistoryCreateManyInput[] = [];

  for (const pack of payload.packs) {
    const packId = packIds.get(pack.index)!;
    packValues.push(
      Prisma.sql`(${packId}, ${pack.index}, ${deviceId}, ${pack.temperature}, ${pack.balancerConnected}, ${pack.current ?? null}, ${pack.power ?? null}, ${persistedAt})`,
    );
    packHistoryRows.push({
      deviceId,
      packIndex: pack.index,
      temperature: pack.temperature,
      balancerConnected: pack.balancerConnected,
      current: pack.current ?? null,
      power: pack.power ?? null,
      recordedAt,
    });

    for (const cell of pack.cells) {
      cellValues.push(
        Prisma.sql`(${randomUUID()}, ${cell.index}, ${packId}, ${cell.voltage}, ${persistedAt})`,
      );
      cellHistoryRows.push({
        deviceId,
        packIndex: pack.index,
        cellIndex: cell.index,
        voltage: cell.voltage,
        recordedAt,
      });
    }
  }

  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.$executeRaw`UPDATE "Device" SET "lastSeen" = ${persistedAt} WHERE "id" = ${deviceId}`,
  ];

  if (packValues.length) {
    ops.push(
      prisma.$executeRaw`
        INSERT INTO "Pack" ("id", "index", "deviceId", "temperature", "balancerConnected", "current", "power", "updatedAt")
        VALUES ${Prisma.join(packValues)}
        ON CONFLICT ("deviceId", "index") DO UPDATE SET
          "temperature" = EXCLUDED."temperature",
          "balancerConnected" = EXCLUDED."balancerConnected",
          "current" = EXCLUDED."current",
          "power" = EXCLUDED."power",
          "updatedAt" = EXCLUDED."updatedAt"`,
    );
  }
  if (cellValues.length) {
    ops.push(
      prisma.$executeRaw`
        INSERT INTO "Cell" ("id", "index", "packId", "voltage", "updatedAt")
        VALUES ${Prisma.join(cellValues)}
        ON CONFLICT ("packId", "index") DO UPDATE SET
          "voltage" = EXCLUDED."voltage",
          "updatedAt" = EXCLUDED."updatedAt"`,
    );
  }
  if (packHistoryRows.length) ops.push(prisma.packHistory.createMany({ data: packHistoryRows }));
  if (cellHistoryRows.length) ops.push(prisma.cellHistory.createMany({ data: cellHistoryRows }));

  await prisma.$transaction(ops);
  return deviceId;
}
