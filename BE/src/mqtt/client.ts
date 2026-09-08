import mqtt, { MqttClient } from "mqtt";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { broadcast } from "@/lib/ws";
import type { BmsDevicePayload } from "@/types/bms";

let client: MqttClient | null = null;

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
    client!.subscribe("bms/+/data", { qos: 1 }, (err) => {
      if (err) console.error("[mqtt] subscribe error", err);
    });
  });

  client.on("message", async (topic, payloadBuf) => {
    try {
      // device_id di topik ("bms/{device_id}/data") = Device.serialNumber, BUKAN Device.id (PK).
      const mqttDeviceId = topic.split("/")[1];
      const payload: BmsDevicePayload = JSON.parse(payloadBuf.toString());

      const device = await persistPayload(mqttDeviceId, payload);
      broadcast("bms:update", { id: device.id, serialNumber: device.serialNumber, ...payload });
    } catch (err) {
      console.error("[mqtt] failed processing", topic, err);
    }
  });

  client.on("error", (err) => console.error("[mqtt] error", err));

  return client;
}

// Simpan payload MQTT: upsert latest-state (Pack/Cell, buat tampilan real-time) +
// insert history (PackHistory/CellHistory, buat grafik tren) dalam satu transaksi.
//
// Kalau serialNumber belum pernah terdaftar, device di-auto-provision (ownerId: null,
// verified: false) — data TETAP disimpan. Verifikasi/ownership itu urusan terpisah
// (lihat POST /api/devices), bukan gating di level ingestion.
async function persistPayload(mqttDeviceId: string, payload: BmsDevicePayload) {
  const recordedAt = new Date(payload.timestamp);

  return prisma.$transaction(async (tx) => {
    const device = await tx.device.upsert({
      where: { serialNumber: mqttDeviceId },
      create: { serialNumber: mqttDeviceId },
      update: {},
    });

    const packHistoryRows: Prisma.PackHistoryCreateManyInput[] = [];
    const cellHistoryRows: Prisma.CellHistoryCreateManyInput[] = [];

    for (const pack of payload.packs) {
      const packRow = await tx.pack.upsert({
        where: { deviceId_index: { deviceId: device.id, index: pack.index } },
        create: {
          deviceId: device.id,
          index: pack.index,
          temperature: pack.temperature,
          balancerConnected: pack.balancerConnected,
        },
        update: {
          temperature: pack.temperature,
          balancerConnected: pack.balancerConnected,
        },
      });

      packHistoryRows.push({
        deviceId: device.id,
        packIndex: pack.index,
        temperature: pack.temperature,
        balancerConnected: pack.balancerConnected,
        recordedAt,
      });

      for (const cell of pack.cells) {
        await tx.cell.upsert({
          where: { packId_index: { packId: packRow.id, index: cell.index } },
          create: { packId: packRow.id, index: cell.index, voltage: cell.voltage },
          update: { voltage: cell.voltage },
        });

        cellHistoryRows.push({
          deviceId: device.id,
          packIndex: pack.index,
          cellIndex: cell.index,
          voltage: cell.voltage,
          recordedAt,
        });
      }
    }

    if (packHistoryRows.length) await tx.packHistory.createMany({ data: packHistoryRows });
    if (cellHistoryRows.length) await tx.cellHistory.createMany({ data: cellHistoryRows });

    return device;
  });
}
