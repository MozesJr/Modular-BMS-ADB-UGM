import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  bucketSeconds,
  cellAggToSeries,
  cellRawToSeries,
  mergeCellAgg,
  mergePackAgg,
  packAggToSeries,
  packRawToSeries,
  RAW_RETENTION_DAYS_DEFAULT,
  type CellAggRow,
  type CellRawRow,
  type HistoryParams,
  type PackAggRow,
  type PackRawRow,
  type SeriesOut,
} from "@/lib/history";
import { encodeCursor } from "@/lib/cursor";

// Lapisan SQL riwayat. Agregasi dilakukan DI DATABASE (tidak pernah memuat jutaan baris ke memori Node).
// Bucket memakai aritmetika epoch (portabel, tanpa date_bin sehingga jalan di PostgreSQL versi lama).

const ts = (d: Date) => Prisma.sql`${d.toISOString()}::timestamp`;
const bucketExpr = (col: string, sec: number) =>
  Prisma.raw(`(to_timestamp(floor(extract(epoch from "${col}") / ${sec}) * ${sec}) AT TIME ZONE 'UTC')`);

export const rawRetentionDays = () => {
  const v = Number.parseInt(process.env.RAW_RETENTION_DAYS ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : RAW_RETENTION_DAYS_DEFAULT;
};

export async function seriesCounts(deviceId: string, packIndex: number | null) {
  const packFilter = packIndex === null ? Prisma.empty : Prisma.sql`AND p."index" = ${packIndex}`;
  const [row] = await prisma.$queryRaw<{ packs: number; cells: number }[]>(Prisma.sql`
    SELECT count(DISTINCT p."id")::int AS packs, count(c."id")::int AS cells
    FROM "Pack" p LEFT JOIN "Cell" c ON c."packId" = p."id"
    WHERE p."deviceId" = ${deviceId} ${packFilter}`);
  return { packCount: row?.packs ?? 0, cellCount: row?.cells ?? 0 };
}

// Rollup menutup semua menit < covered. Null = belum ada rollup untuk device ini.
async function rollupCoveredUntil(table: "PackRollup1m" | "CellRollup1m", deviceId: string): Promise<Date | null> {
  const [row] = await prisma.$queryRaw<{ m: Date | null }[]>(
    Prisma.sql`SELECT max("bucketStart") AS m FROM ${Prisma.raw(`"${table}"`)} WHERE "deviceId" = ${deviceId}`,
  );
  return row?.m ? new Date(row.m.getTime() + 60_000) : null;
}

// Batas menit: rollup melayani bucketStart < boundary, raw melayani recordedAt >= boundary (sampai `to`, inklusif).
// Raw tidak pernah dihapus di atas min(cutoff, yang sudah di-rollup), jadi kedua sisi selalu punya datanya.
// boundary boleh mencapai AKHIR menit yang memuat `to` (bukan `to` itu sendiri): bila seluruh rentang sudah di-rollup,
// menit yang memuat `to` harus tetap ikut dari rollup (raw-nya sudah dihapus).
export function boundaryFor(covered: Date | null, from: Date, to: Date, now: Date, rawDays = rawRetentionDays()): Date {
  if (!covered) return from;
  const cutoff = new Date(now.getTime() - rawDays * 86_400_000);
  const b = Math.min(cutoff.getTime(), covered.getTime());
  const minuteFloor = Math.floor(b / 60_000) * 60_000;
  const toExclusive = Math.floor(to.getTime() / 60_000) * 60_000 + 60_000;
  return new Date(Math.min(Math.max(minuteFloor, from.getTime()), toExclusive));
}

const packFilter = (p: HistoryParams, col = '"packIndex"') =>
  p.packIndex === null ? Prisma.empty : Prisma.sql`AND ${Prisma.raw(col)} = ${p.packIndex}`;

async function packAggRaw(deviceId: string, p: HistoryParams, from: Date, to: Date, sec: number): Promise<PackAggRow[]> {
  return prisma.$queryRaw<PackAggRow[]>(Prisma.sql`
    SELECT "packIndex", ${bucketExpr("recordedAt", sec)} AS t,
      avg("temperature") AS "tempAvg", min("temperature") AS "tempMin", max("temperature") AS "tempMax", count("temperature")::int AS "tempN",
      avg("current") AS "curAvg", min("current") AS "curMin", max("current") AS "curMax", count("current")::int AS "curN",
      avg("power") AS "powAvg", min("power") AS "powMin", max("power") AS "powMax", count("power")::int AS "powN"
    FROM "PackHistory"
    WHERE "deviceId" = ${deviceId} AND "recordedAt" >= ${ts(from)} AND "recordedAt" <= ${ts(to)} ${packFilter(p)}
    GROUP BY 1, 2`);
}

async function packAggRollup(deviceId: string, p: HistoryParams, from: Date, boundary: Date, sec: number): Promise<PackAggRow[]> {
  return prisma.$queryRaw<PackAggRow[]>(Prisma.sql`
    SELECT "packIndex", ${bucketExpr("bucketStart", sec)} AS t,
      sum("tempAvg" * "tempCount") / NULLIF(sum("tempCount"), 0) AS "tempAvg", min("tempMin") AS "tempMin", max("tempMax") AS "tempMax", coalesce(sum("tempCount"), 0)::int AS "tempN",
      sum("currentAvg" * "currentCount") / NULLIF(sum("currentCount"), 0) AS "curAvg", min("currentMin") AS "curMin", max("currentMax") AS "curMax", coalesce(sum("currentCount"), 0)::int AS "curN",
      sum("powerAvg" * "powerCount") / NULLIF(sum("powerCount"), 0) AS "powAvg", min("powerMin") AS "powMin", max("powerMax") AS "powMax", coalesce(sum("powerCount"), 0)::int AS "powN"
    FROM "PackRollup1m"
    WHERE "deviceId" = ${deviceId} AND "bucketStart" >= ${ts(new Date(Math.floor(from.getTime() / 60_000) * 60_000))} AND "bucketStart" < ${ts(boundary)} ${packFilter(p)}
    GROUP BY 1, 2`);
}

async function cellAggRaw(deviceId: string, p: HistoryParams, from: Date, to: Date, sec: number): Promise<CellAggRow[]> {
  return prisma.$queryRaw<CellAggRow[]>(Prisma.sql`
    SELECT "packIndex", "cellIndex", ${bucketExpr("recordedAt", sec)} AS t,
      avg("voltage") AS avg, min("voltage") AS min, max("voltage") AS max, count(*)::int AS n
    FROM "CellHistory"
    WHERE "deviceId" = ${deviceId} AND "recordedAt" >= ${ts(from)} AND "recordedAt" <= ${ts(to)} ${packFilter(p)}
    GROUP BY 1, 2, 3`);
}

async function cellAggRollup(deviceId: string, p: HistoryParams, from: Date, boundary: Date, sec: number): Promise<CellAggRow[]> {
  return prisma.$queryRaw<CellAggRow[]>(Prisma.sql`
    SELECT "packIndex", "cellIndex", ${bucketExpr("bucketStart", sec)} AS t,
      sum("vAvg" * "samples") / NULLIF(sum("samples"), 0) AS avg, min("vMin") AS min, max("vMax") AS max, sum("samples")::int AS n
    FROM "CellRollup1m"
    WHERE "deviceId" = ${deviceId} AND "bucketStart" >= ${ts(new Date(Math.floor(from.getTime() / 60_000) * 60_000))} AND "bucketStart" < ${ts(boundary)} ${packFilter(p)}
    GROUP BY 1, 2, 3`);
}

export async function loadHistory(
  deviceId: string,
  p: HistoryParams,
  now: Date = new Date(),
): Promise<{ series: SeriesOut[]; nextCursor: string | null }> {
  const wantsPack = p.metrics.some((m) => m !== "voltage");
  const wantsCell = p.metrics.includes("voltage");

  // ---- raw: keyset pagination (recordedAt, packIndex[, cellIndex]) ----
  if (p.bucket === "raw") {
    const limit = p.limit;
    if (wantsCell) {
      const after = p.cursor
        ? Prisma.sql`AND ("recordedAt", "packIndex", "cellIndex") > (${ts(p.cursor.t)}, ${p.cursor.p}, ${p.cursor.c ?? -1})`
        : Prisma.empty;
      const rows = await prisma.$queryRaw<CellRawRow[]>(Prisma.sql`
        SELECT "packIndex", "cellIndex", "recordedAt" AS t, "voltage"
        FROM "CellHistory"
        WHERE "deviceId" = ${deviceId} AND "recordedAt" >= ${ts(p.from)} AND "recordedAt" <= ${ts(p.to)} ${packFilter(p)} ${after}
        ORDER BY "recordedAt", "packIndex", "cellIndex" LIMIT ${limit + 1}`);
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        series: cellRawToSeries(page),
        nextCursor: rows.length > limit && last ? encodeCursor({ t: last.t.toISOString(), p: last.packIndex, c: last.cellIndex }) : null,
      };
    }
    const after = p.cursor ? Prisma.sql`AND ("recordedAt", "packIndex") > (${ts(p.cursor.t)}, ${p.cursor.p})` : Prisma.empty;
    const rows = await prisma.$queryRaw<PackRawRow[]>(Prisma.sql`
      SELECT "packIndex", "recordedAt" AS t, "temperature", "current", "power"
      FROM "PackHistory"
      WHERE "deviceId" = ${deviceId} AND "recordedAt" >= ${ts(p.from)} AND "recordedAt" <= ${ts(p.to)} ${packFilter(p)} ${after}
      ORDER BY "recordedAt", "packIndex" LIMIT ${limit + 1}`);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      series: packRawToSeries(page, p.metrics),
      nextCursor: rows.length > limit && last ? encodeCursor({ t: last.t.toISOString(), p: last.packIndex, c: null }) : null,
    };
  }

  // ---- agregat: rollup untuk bagian lama + raw untuk bagian baru, digabung ----
  const sec = bucketSeconds(p.bucket);
  const series: SeriesOut[] = [];

  if (wantsPack) {
    const boundary = boundaryFor(await rollupCoveredUntil("PackRollup1m", deviceId), p.from, p.to, now);
    const [old, recent] = await Promise.all([
      boundary > p.from ? packAggRollup(deviceId, p, p.from, boundary, sec) : Promise.resolve([] as PackAggRow[]),
      boundary <= p.to ? packAggRaw(deviceId, p, boundary, p.to, sec) : Promise.resolve([] as PackAggRow[]),
    ]);
    series.push(...packAggToSeries(mergePackAgg([...old, ...recent]), p.metrics));
  }
  if (wantsCell) {
    const boundary = boundaryFor(await rollupCoveredUntil("CellRollup1m", deviceId), p.from, p.to, now);
    const [old, recent] = await Promise.all([
      boundary > p.from ? cellAggRollup(deviceId, p, p.from, boundary, sec) : Promise.resolve([] as CellAggRow[]),
      boundary <= p.to ? cellAggRaw(deviceId, p, boundary, p.to, sec) : Promise.resolve([] as CellAggRow[]),
    ]);
    series.push(...cellAggToSeries(mergeCellAgg([...old, ...recent])));
  }
  return { series, nextCursor: null };
}
