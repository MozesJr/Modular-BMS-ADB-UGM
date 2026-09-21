import mqtt, { MqttClient } from "mqtt";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { broadcast } from "@/lib/ws";
import { log } from "@/lib/logger";
import { incr, runtime } from "@/lib/runtime-state";
import { parseBmsMessage } from "@/mqtt/schema";
import type { BmsDevicePayload } from "@/mqtt/schema";
import { resolveRecordedAt } from "@/mqtt/timestamp";

// Pesan invalid dari device yang rusak bisa datang tiap detik; batasi log-nya (counter tetap akurat).
const INVALID_LOG_INTERVAL_MS = 10_000;
const lastInvalidLogAt = new Map<string, number>();

function shouldLogInvalid(key: string): boolean {
  const now = Date.now();
  if (now - (lastInvalidLogAt.get(key) ?? 0) < INVALID_LOG_INTERVAL_MS) return false;
  if (lastInvalidLogAt.size > 5000) lastInvalidLogAt.clear(); // batas memori
  lastInvalidLogAt.set(key, now);
  return true;
}

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
    runtime().mqtt.connected = true;
    runtime().mqtt.lastConnectAt = Date.now();
    log.info("mqtt.connected");
    client!.subscribe("bms/+/data", { qos: 1 }, (err, granted) => {
      if (err) log.error("mqtt.subscribe_failed", { err });
      else log.info("mqtt.subscribed", { topics: (granted ?? []).map((g) => `${g.topic}@qos${g.qos}`) });
    });
  });

  client.on("message", async (topic, payloadBuf) => {
    const receivedAt = new Date();
    runtime().mqtt.lastMessageAt = receivedAt.getTime();
    incr("mqtt.received");

    // Validasi dulu: hanya objek hasil parse (field dikenal, rentang wajar) yang boleh masuk DB dan WS.
    const parsed = parseBmsMessage(topic, payloadBuf);
    if (!parsed.ok) {
      incr("mqtt.invalid");
      incr(`mqtt.invalid.${parsed.reason}`);
      if (shouldLogInvalid(`${parsed.deviceId ?? "?"}:${parsed.reason}`)) {
        log.warn("mqtt.invalid_payload", {
          topic: topic.slice(0, 120),
          deviceId: parsed.deviceId,
          reason: parsed.reason,
          detail: parsed.detail,
          bytes: payloadBuf.byteLength,
        });
      }
      return;
    }

    try {
      const { recordedAt, source } = resolveRecordedAt(parsed.payload.timestamp, receivedAt);
      if (source === "server") incr("mqtt.clock_skewed");

      const device = await persistPayload(parsed.deviceId, parsed.payload, recordedAt);
      incr("mqtt.stored");
      broadcast("bms:update", {
        id: device.id,
        serialNumber: device.serialNumber,
        timestamp: recordedAt.getTime(),
        receivedAt: receivedAt.getTime(),
        packs: parsed.payload.packs,
      });
    } catch (err) {
      incr("mqtt.failed");
      log.error("mqtt.persist_failed", { deviceId: parsed.deviceId, err });
    }
  });

  client.on("error", (err) => log.error("mqtt.error", { err }));
  // Lifecycle koneksi broker — low-frequency, penting buat diagnosa "kenapa data berhenti masuk"
  // tanpa harus nunggu ada error eksplisit (mis. network putus tapi belum reconnect).
  client.on("reconnect", () => log.info("mqtt.reconnecting"));
  client.on("close", () => {
    runtime().mqtt.connected = false;
    log.info("mqtt.closed");
  });
  client.on("offline", () => log.info("mqtt.offline"));

  return client;
}

// Simpan payload MQTT: upsert latest-state (Pack/Cell, buat tampilan real-time) +
// insert history (PackHistory/CellHistory, buat grafik tren) dalam satu transaksi.
//
// Kalau serialNumber belum pernah terdaftar, device di-auto-provision (ownerId: null,
// verified: false) — data TETAP disimpan. Verifikasi/ownership itu urusan terpisah
// (lihat POST /api/devices), bukan gating di level ingestion.
async function persistPayload(mqttDeviceId: string, payload: BmsDevicePayload, recordedAt: Date) {

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
          current: pack.current ?? null,
          power: pack.power ?? null,
        },
        update: {
          temperature: pack.temperature,
          balancerConnected: pack.balancerConnected,
          current: pack.current ?? null,
          power: pack.power ?? null,
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
