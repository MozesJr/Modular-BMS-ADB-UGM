import { z } from "zod";

// KONTRAK MQTT (lihat docs/MQTT-CONTRACT.md). Mengubah skema ini = mengubah kontrak dengan
// firmware ESP32: update dokumen + beri tahu tim firmware + cek dampak ke mobile/FE.

export const MAX_PAYLOAD_BYTES = 64 * 1024;
export const MAX_PACKS = 16;
export const MAX_CELLS_PER_PACK = 64;

// Suhu di luar rentang fisik yang masuk akal dianggap SENSOR FAULT (mis. -127 saat DS18B20 terlepas):
// nilainya dijadikan null dan dihitung, BUKAN menolak seluruh pesan (tegangan cell tetap disimpan).
export const TEMPERATURE_MIN_C = -60;
export const TEMPERATURE_MAX_C = 150;

// device_id di topik = Device.serialNumber. Sengaja ketat: tanpa "/", "+", "#", spasi.
export const DEVICE_ID_REGEX = /^[A-Za-z0-9._-]{1,64}$/;

// Firmware lama mungkin mengirim null untuk field opsional -> dianggap tidak ada.
const optionalNumber = (min: number, max: number) =>
  z
    .number()
    .min(min)
    .max(max)
    .nullish()
    .transform((v) => v ?? undefined);

export const BmsCellSchema = z.object({
  index: z.number().int().min(0).max(255),
  voltage: z.number().min(0).max(10), // volt
});

export const BmsPackSchema = z
  .object({
    index: z.number().int().min(0).max(63),
    // °C. null / dihilangkan = tidak ada pembacaan. Di luar [-60, 150] -> diubah jadi null (sensor fault, lihat normalizeTemperatures).
    temperature: z
      .number()
      .nullish()
      .transform((v) => v ?? null)
      .describe("°C; null/omitted = no reading; values outside [-60,150] are treated as sensor fault (stored as null)"),
    balancerConnected: z.boolean(),
    current: optionalNumber(-1000, 1000), // A; negatif = charging, positif = discharging
    power: optionalNumber(-1_000_000, 1_000_000), // W = voltage_pack × current
    cells: z.array(BmsCellSchema).min(1).max(MAX_CELLS_PER_PACK),
  })
  .refine((p) => new Set(p.cells.map((c) => c.index)).size === p.cells.length, {
    message: "cells[].index harus unik dalam satu pack",
    path: ["cells"],
  });

export const BmsDevicePayloadSchema = z
  .object({
    timestamp: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), // unix ms (jam device)
    packs: z.array(BmsPackSchema).min(1).max(MAX_PACKS),
  })
  .refine((d) => new Set(d.packs.map((p) => p.index)).size === d.packs.length, {
    message: "packs[].index harus unik",
    path: ["packs"],
  });

export type BmsCellPayload = z.infer<typeof BmsCellSchema>;
export type BmsPackPayload = z.infer<typeof BmsPackSchema>;
export type BmsDevicePayload = z.infer<typeof BmsDevicePayloadSchema>;

export type ParseFailure = {
  ok: false;
  reason: "topic" | "too_large" | "json" | "schema";
  detail: string;
  deviceId?: string;
};
export type ParseSuccess = {
  ok: true;
  deviceId: string;
  payload: BmsDevicePayload;
  /** jumlah pack yang suhunya di luar rentang dan diubah menjadi null */
  sensorFaults: number;
};

// Mengubah suhu di luar rentang menjadi null (sensor fault). Mengembalikan payload baru + jumlah fault.
export function normalizeTemperatures(payload: BmsDevicePayload): { payload: BmsDevicePayload; sensorFaults: number } {
  let sensorFaults = 0;
  const packs = payload.packs.map((p) => {
    if (p.temperature !== null && (p.temperature < TEMPERATURE_MIN_C || p.temperature > TEMPERATURE_MAX_C)) {
      sensorFaults++;
      return { ...p, temperature: null };
    }
    return p;
  });
  return { payload: { ...payload, packs }, sensorFaults };
}

// Topik yang valid: bms/{device_id}/data
export function parseDeviceIdFromTopic(topic: string): string | null {
  const parts = topic.split("/");
  if (parts.length !== 3 || parts[0] !== "bms" || parts[2] !== "data") return null;
  return DEVICE_ID_REGEX.test(parts[1]) ? parts[1] : null;
}

export function parseBmsMessage(topic: string, body: Buffer): ParseSuccess | ParseFailure {
  const deviceId = parseDeviceIdFromTopic(topic);
  if (!deviceId) return { ok: false, reason: "topic", detail: "topik tidak valid" };
  if (body.byteLength > MAX_PAYLOAD_BYTES) {
    return { ok: false, reason: "too_large", detail: `${body.byteLength} byte`, deviceId };
  }

  let json: unknown;
  try {
    json = JSON.parse(body.toString("utf8"));
  } catch {
    return { ok: false, reason: "json", detail: "bukan JSON valid", deviceId };
  }

  const result = BmsDevicePayloadSchema.safeParse(json);
  if (!result.success) {
    const detail = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { ok: false, reason: "schema", detail, deviceId };
  }
  const { payload, sensorFaults } = normalizeTemperatures(result.data);
  return { ok: true, deviceId, payload, sensorFaults };
}
