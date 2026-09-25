// Energi (Wh) dari daya pack — sumber tunggal untuk konstanta gap & untuk "energi hari ini"
// (dipakai GET /api/devices/summary). Rumus trapezoid inti (kontribusi = (p1+p2)/2 * dt/3600)
// IDENTIK dengan devices/[id]/history/route.ts (lihat komentar di sana) — hanya konstanta gap
// yang di-share langsung karena bentuk agregasinya beda: /history menjumlah per (bucket, pack)
// dan MENDROP segmen yang melintasi awal rentang `from`, sedangkan computeEnergyToday di bawah
// menjumlah per DEVICE (lintas pack) dan MEMOTONG (clip + interpolasi linear) segmen yang
// melintasi batas 00:00 WIB alih-alih mendrop-nya — kebutuhan yang spesifik untuk kontrak ini.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Kontrak sampling MQTT ~10 detik. Segmen antar sampel > 2x ini dianggap gap (offline) dan
// tidak dihitung sebagai energi — sama persis dengan devices/[id]/history/route.ts.
export const ENERGY_SAMPLING_INTERVAL_S = 10;
export const ENERGY_GAP_S = 2 * ENERGY_SAMPLING_INTERVAL_S;

// Margin lookback sebelum batas hari: cukup besar dibanding ENERGY_GAP_S (20s) supaya baris
// PackHistory tepat sebelum batas selalu ikut ter-query (untuk interpolasi titik potong), tapi
// tetap kecil untuk performa query.
const LOOKBACK_INTERVAL = Prisma.sql`interval '10 minutes'`;

export type EnergyToday = {
  sinceUtc: string;
  byDevice: Map<string, { energyInWh: number; energyOutWh: number }>;
};

type SinceRow = { since_utc: Date };
type EnergyRow = { deviceId: string; energyinwh: number | null; energyoutwh: number | null };

// Energi hari ini (sejak 00:00 WIB) per device, integrasi trapezoid daya. Batas hari dihitung DI
// SQL (date_trunc + AT TIME ZONE 'Asia/Jakarta', tanpa DST) supaya tidak tergantung timezone app
// server. `now` opsional untuk tes deterministik — bila diisi, dipakai SQL sebagai pengganti
// now() (batas & lookback tetap dihitung SQL, bukan di-precompute di JS).
export async function computeEnergyToday(deviceIds: string[], opts?: { now?: Date }): Promise<EnergyToday> {
  const nowExpr = opts?.now ? Prisma.sql`${opts.now}::timestamptz` : Prisma.sql`now()`;

  const sinceRows = await prisma.$queryRaw<SinceRow[]>`
    SELECT (date_trunc('day', ${nowExpr} AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta') AS since_utc`;
  const sinceUtc = sinceRows[0].since_utc;

  const byDevice = new Map<string, { energyInWh: number; energyOutWh: number }>();
  if (deviceIds.length === 0) return { sinceUtc: sinceUtc.toISOString(), byDevice };

  // Segmen (prev_t, prev_power) -> (recordedAt, power) yang melintasi sinceUtc DIPOTONG: hanya
  // porsi [sinceUtc, recordedAt] yang dihitung, dengan power di titik potong diinterpolasi linear
  // dari prev_power/power. Aturan gap (> 2x interval) dievaluasi dari segmen PENUH (prev_t ->
  // recordedAt), bukan segmen yang sudah dipotong.
  const rows = await prisma.$queryRaw<EnergyRow[]>`
    WITH rows AS (
      SELECT
        "deviceId", "packIndex", "recordedAt", "power",
        lag("power") OVER w AS prev_power,
        lag("recordedAt") OVER w AS prev_t
      FROM "PackHistory"
      WHERE "deviceId" IN (${Prisma.join(deviceIds)})
        AND "recordedAt" >= ${sinceUtc} - ${LOOKBACK_INTERVAL}
      WINDOW w AS (PARTITION BY "deviceId", "packIndex" ORDER BY "recordedAt")
    ),
    seg AS (
      SELECT "deviceId",
        CASE
          WHEN prev_t IS NULL THEN 0
          WHEN "power" IS NULL OR prev_power IS NULL THEN 0
          WHEN "recordedAt" <= ${sinceUtc} THEN 0
          WHEN EXTRACT(EPOCH FROM ("recordedAt" - prev_t)) > ${ENERGY_GAP_S} THEN 0
          WHEN prev_t >= ${sinceUtc} THEN
            ("power" + prev_power) / 2.0 * EXTRACT(EPOCH FROM ("recordedAt" - prev_t)) / 3600.0
          ELSE
            (
              "power" + (
                prev_power + ("power" - prev_power)
                  * EXTRACT(EPOCH FROM (${sinceUtc} - prev_t))
                  / EXTRACT(EPOCH FROM ("recordedAt" - prev_t))
              )
            ) / 2.0 * EXTRACT(EPOCH FROM ("recordedAt" - ${sinceUtc})) / 3600.0
        END AS contribution
      FROM rows
    )
    SELECT "deviceId",
      SUM(CASE WHEN contribution < 0 THEN -contribution ELSE 0 END) AS energyinwh,
      SUM(CASE WHEN contribution > 0 THEN contribution ELSE 0 END) AS energyoutwh
    FROM seg
    GROUP BY "deviceId"`;

  for (const row of rows) {
    byDevice.set(row.deviceId, { energyInWh: row.energyinwh ?? 0, energyOutWh: row.energyoutwh ?? 0 });
  }
  return { sinceUtc: sinceUtc.toISOString(), byDevice };
}
