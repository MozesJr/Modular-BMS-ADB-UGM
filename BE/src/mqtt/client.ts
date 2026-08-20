import mqtt, { MqttClient } from "mqtt";
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
      const deviceId = topic.split("/")[1];
      const payload: BmsDevicePayload = JSON.parse(payloadBuf.toString());

      await persistPayload(deviceId, payload);
      broadcast("bms:update", { deviceId, ...payload });
    } catch (err) {
      console.error("[mqtt] failed processing", topic, err);
    }
  });

  client.on("error", (err) => console.error("[mqtt] error", err));

  return client;
}

async function persistPayload(deviceId: string, payload: BmsDevicePayload) {
  // TODO: sesuaikan setelah schema.prisma final direview
  for (const pack of payload.packs) {
    console.log(`[mqtt] device=${deviceId} pack=${pack.index} temp=${pack.temperature}`);
  }
}