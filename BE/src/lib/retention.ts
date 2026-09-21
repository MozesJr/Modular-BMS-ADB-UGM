import { Prisma, type PrismaClient } from "@prisma/client";

// Retensi + rollup riwayat (dijalankan terjadwal oleh scripts: `node dist/scripts/retention.js [--execute]`).
//   1. rollup 1 menit dari PackHistory/CellHistory (idempoten: INSERT ... ON CONFLICT DO UPDATE)
//   2. hapus raw yang lebih tua dari `rawDays` — HANYA setelah rentang itu ter-rollup di run yang sama
//   3. hapus rollup lebih tua dari `rollupDays`
//   4. bersihkan refresh token & reset token yang sudah lama tak berlaku
// Default DRY-RUN (hanya menghitung). Semua kueri per-device supaya memakai indeks (deviceId, recordedAt).

export interface RetentionOptions {
  execute: boolean;
  rawDays: number;
  rollupDays: number;
  lookbackHours: number; // jendela hitung ulang rollup terbaru (menangkap data terlambat)
  chunkHours: number; // ukuran satu pernyataan agregasi
  deleteBatch: number;
  tokenGraceDays: number;
  now?: Date;
}

export const DEFAULT_RETENTION: RetentionOptions = {
  execute: false,
  rawDays: 30,
  rollupDays: 365,
  lookbackHours: 48,
  chunkHours: 6,
  deleteBatch: 20_000,
  tokenGraceDays: 7,
};

export interface TableReport {
  rollupRanges: { from: string; to: string }[];
  rawRowsAggregated: number; // dry-run: baris yang AKAN diagregasi; execute: jumlah baris sumber yang diproses
  rollupRowsWritten: number;
  rawRowsDeleted: number; // dry-run: yang AKAN dihapus
}

export interface RetentionReport {
  mode: "dry-run" | "execute";
  now: string;
  rawCutoff: string;
  pack: TableReport;
  cell: TableReport;
  rollupRowsPruned: number;
  refreshTokensPruned: number;
  resetTokensPruned: number;
}

const minute = 60_000;
const floorMin = (d: Date) => new Date(Math.floor(d.getTime() / minute) * minute);
const ts = (d: Date) => Prisma.sql`${d.toISOString()}::timestamp`;

type Kind = "pack" | "cell";
const CFG = {
  pack: { raw: '"PackHistory"', rollup: '"PackRollup1m"' },
  cell: { raw: '"CellHistory"', rollup: '"CellRollup1m"' },
} as const;

async function rollupChunk(prisma: PrismaClient, kind: Kind, deviceId: string, from: Date, to: Date): Promise<number> {
  if (kind === "pack") {
    return prisma.$executeRaw(Prisma.sql`
      INSERT INTO "PackRollup1m" ("deviceId","packIndex","bucketStart","samples",
        "tempAvg","tempMin","tempMax","tempCount","currentAvg","currentMin","currentMax","currentCount","powerAvg","powerMin","powerMax","powerCount")
      SELECT "deviceId","packIndex", date_trunc('minute',"recordedAt") AS b, count(*)::int,
        avg("temperature"),min("temperature"),max("temperature"),count("temperature")::int,
        avg("current"),min("current"),max("current"),count("current")::int,
        avg("power"),min("power"),max("power"),count("power")::int
      FROM "PackHistory"
      WHERE "deviceId" = ${deviceId} AND "recordedAt" >= ${ts(from)} AND "recordedAt" < ${ts(to)}
      GROUP BY 1,2,3
      ON CONFLICT ("deviceId","packIndex","bucketStart") DO UPDATE SET
        "samples"=EXCLUDED."samples",
        "tempAvg"=EXCLUDED."tempAvg","tempMin"=EXCLUDED."tempMin","tempMax"=EXCLUDED."tempMax","tempCount"=EXCLUDED."tempCount",
        "currentAvg"=EXCLUDED."currentAvg","currentMin"=EXCLUDED."currentMin","currentMax"=EXCLUDED."currentMax","currentCount"=EXCLUDED."currentCount",
        "powerAvg"=EXCLUDED."powerAvg","powerMin"=EXCLUDED."powerMin","powerMax"=EXCLUDED."powerMax","powerCount"=EXCLUDED."powerCount"`);
  }
  return prisma.$executeRaw(Prisma.sql`
    INSERT INTO "CellRollup1m" ("deviceId","packIndex","cellIndex","bucketStart","samples","vAvg","vMin","vMax")
    SELECT "deviceId","packIndex","cellIndex", date_trunc('minute',"recordedAt") AS b, count(*)::int, avg("voltage"),min("voltage"),max("voltage")
    FROM "CellHistory"
    WHERE "deviceId" = ${deviceId} AND "recordedAt" >= ${ts(from)} AND "recordedAt" < ${ts(to)}
    GROUP BY 1,2,3,4
    ON CONFLICT ("deviceId","packIndex","cellIndex","bucketStart") DO UPDATE SET
      "samples"=EXCLUDED."samples","vAvg"=EXCLUDED."vAvg","vMin"=EXCLUDED."vMin","vMax"=EXCLUDED."vMax"`);
}

async function countRaw(prisma: PrismaClient, kind: Kind, deviceId: string, from: Date, to: Date, inclusiveFrom = true): Promise<number> {
  const raw = Prisma.raw(CFG[kind].raw);
  const [row] = await prisma.$queryRaw<{ n: number }[]>(
    Prisma.sql`SELECT count(*)::int AS n FROM ${raw} WHERE "deviceId" = ${deviceId} AND "recordedAt" ${Prisma.raw(inclusiveFrom ? ">=" : ">")} ${ts(from)} AND "recordedAt" < ${ts(to)}`,
  );
  return row?.n ?? 0;
}

async function oldestRaw(prisma: PrismaClient, kind: Kind, deviceId: string): Promise<Date | null> {
  const [row] = await prisma.$queryRaw<{ m: Date | null }[]>(
    Prisma.sql`SELECT min("recordedAt") AS m FROM ${Prisma.raw(CFG[kind].raw)} WHERE "deviceId" = ${deviceId}`,
  );
  return row?.m ?? null;
}

async function watermark(prisma: PrismaClient, kind: Kind, deviceId: string): Promise<Date | null> {
  const [row] = await prisma.$queryRaw<{ m: Date | null }[]>(
    Prisma.sql`SELECT max("bucketStart") AS m FROM ${Prisma.raw(CFG[kind].rollup)} WHERE "deviceId" = ${deviceId}`,
  );
  return row?.m ?? null;
}

async function processKind(prisma: PrismaClient, kind: Kind, deviceIds: string[], o: RetentionOptions, now: Date): Promise<TableReport> {
  const report: TableReport = { rollupRanges: [], rawRowsAggregated: 0, rollupRowsWritten: 0, rawRowsDeleted: 0 };
  const end = floorMin(new Date(now.getTime() - 2 * minute)); // menit yang sudah lengkap
  const cutoff = new Date(now.getTime() - o.rawDays * 86_400_000);
  const deleteBefore = floorMin(new Date(Math.min(cutoff.getTime(), end.getTime())));
  const chunk = o.chunkHours * 3600_000;

  for (const deviceId of deviceIds) {
    const oldest = await oldestRaw(prisma, kind, deviceId);
    if (!oldest) continue;
    const wm = await watermark(prisma, kind, deviceId);
    const startRecent = floorMin(wm ? new Date(wm.getTime() - o.lookbackHours * 3600_000) : oldest);

    // A: raw yang akan dihapus dan belum dijamin ter-rollup (di bawah jendela hitung ulang). B: jendela terbaru.
    const ranges: [Date, Date][] = [];
    const aEnd = new Date(Math.min(deleteBefore.getTime(), startRecent.getTime()));
    if (floorMin(oldest) < aEnd) ranges.push([floorMin(oldest), aEnd]);
    if (startRecent < end) ranges.push([startRecent, end]);

    let allOk = true;
    for (const [from, to] of ranges) {
      report.rollupRanges.push({ from: from.toISOString(), to: to.toISOString() });
      for (let a = from.getTime(); a < to.getTime(); a += chunk) {
        const c0 = new Date(a);
        const c1 = new Date(Math.min(a + chunk, to.getTime()));
        if (!o.execute) {
          report.rawRowsAggregated += await countRaw(prisma, kind, deviceId, c0, c1);
          continue;
        }
        try {
          report.rollupRowsWritten += await rollupChunk(prisma, kind, deviceId, c0, c1);
        } catch (e) {
          allOk = false;
          throw e;
        }
      }
    }

    // Hapus raw < deleteBefore hanya bila rollup untuk rentang itu sudah selesai di run ini.
    if (!o.execute) {
      report.rawRowsDeleted += await countRaw(prisma, kind, deviceId, new Date(0), deleteBefore);
    } else if (allOk) {
      const raw = Prisma.raw(CFG[kind].raw);
      for (;;) {
        const n = await prisma.$executeRaw(Prisma.sql`
          DELETE FROM ${raw} WHERE "id" IN (
            SELECT "id" FROM ${raw} WHERE "deviceId" = ${deviceId} AND "recordedAt" < ${ts(deleteBefore)} LIMIT ${o.deleteBatch})`);
        report.rawRowsDeleted += n;
        if (n < o.deleteBatch) break;
      }
    }
  }
  return report;
}

export async function runRetention(prisma: PrismaClient, opts: Partial<RetentionOptions> = {}): Promise<RetentionReport> {
  const o = { ...DEFAULT_RETENTION, ...opts };
  const now = o.now ?? new Date();
  const devices = await prisma.device.findMany({ select: { id: true } });
  const deviceIds = devices.map((d) => d.id);

  const pack = await processKind(prisma, "pack", deviceIds, o, now);
  const cell = await processKind(prisma, "cell", deviceIds, o, now);

  const rollupCutoff = new Date(now.getTime() - o.rollupDays * 86_400_000);
  const tokenCutoff = new Date(now.getTime() - o.tokenGraceDays * 86_400_000);

  let rollupRowsPruned = 0;
  let refreshTokensPruned = 0;
  let resetTokensPruned = 0;
  const packRollup = await prisma.packRollup1m.count({ where: { bucketStart: { lt: rollupCutoff } } });
  const cellRollup = await prisma.cellRollup1m.count({ where: { bucketStart: { lt: rollupCutoff } } });
  const refresh = await prisma.refreshToken.count({ where: { OR: [{ expiresAt: { lt: tokenCutoff } }, { revokedAt: { lt: tokenCutoff } }] } });
  const reset = await prisma.passwordResetToken.count({ where: { expiresAt: { lt: tokenCutoff } } });
  if (o.execute) {
    rollupRowsPruned =
      (await prisma.packRollup1m.deleteMany({ where: { bucketStart: { lt: rollupCutoff } } })).count +
      (await prisma.cellRollup1m.deleteMany({ where: { bucketStart: { lt: rollupCutoff } } })).count;
    refreshTokensPruned = (await prisma.refreshToken.deleteMany({ where: { OR: [{ expiresAt: { lt: tokenCutoff } }, { revokedAt: { lt: tokenCutoff } }] } })).count;
    resetTokensPruned = (await prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: tokenCutoff } } })).count;
  } else {
    rollupRowsPruned = packRollup + cellRollup;
    refreshTokensPruned = refresh;
    resetTokensPruned = reset;
  }

  return {
    mode: o.execute ? "execute" : "dry-run",
    now: now.toISOString(),
    rawCutoff: new Date(now.getTime() - o.rawDays * 86_400_000).toISOString(),
    pack,
    cell,
    rollupRowsPruned,
    refreshTokensPruned,
    resetTokensPruned,
  };
}
