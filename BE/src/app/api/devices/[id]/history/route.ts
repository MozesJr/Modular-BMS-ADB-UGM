// BE/src/app/api/devices/[id]/history/route.ts
//
// History teragregasi di DB (Postgres date_bin) — mengembalikan bucket per pack alih-alih
// ribuan row mentah. Dipakai FE envelope chart (min/max/avg/delta cell + suhu) dan mobile app.
//
// Query:
//   ?hours=24        rentang waktu (default 24, clamp ke MAX_HOURS)
//   ?bucket=auto|<detik>  lebar bucket; auto = 6h→30s, 24h→2m, 7h→15m (clamp 10..3600)
//   ?cells=1         sertakan rata-rata voltage per cell per bucket (untuk chart per-cell)
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/authz";

const DEFAULT_HOURS = 24;
const MAX_HOURS = 24 * 30;
const MIN_BUCKET_S = 10;
const MAX_BUCKET_S = 3600;

function autoBucketSeconds(hours: number): number {
  if (hours <= 6) return 30;
  if (hours <= 24) return 120;
  return 900;
}

type CellAggRow = {
  bucket: Date;
  packIndex: number;
  cellmin: number;
  cellmax: number;
  cellavg: number;
};
type TempAggRow = {
  bucket: Date;
  packIndex: number;
  tempavg: number | null;
  currentavg: number | null;
  poweravg: number | null;
  balanceron: boolean;
};
type CellPerRow = {
  bucket: Date;
  packIndex: number;
  cellIndex: number;
  vavg: number;
};

type HistoryBucket = {
  t: string;
  cellMin: number | null;
  cellMax: number | null;
  cellAvg: number | null;
  deltaMv: number | null;
  tempAvg: number | null;
  currentAvg: number | null;
  powerAvg: number | null;
  energyWh: number | null; // integral daya dalam bucket: avg power × durasi bucket / 3600
  balancerOn: boolean;
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const device = await prisma.device.findUnique({
    where: { id },
    select: {
      ownerId: true,
      collaborators: { select: { userId: true } },
    },
  });
  if (!device) {
    return NextResponse.json({ error: "Device tidak ditemukan" }, { status: 404 });
  }
  const isOwner = device.ownerId === session.user.id;
  const isCollaborator = device.collaborators.some((c) => c.userId === session.user.id);
  if (!isOwner && !isCollaborator) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const hoursParam = Number(searchParams.get("hours"));
  const hours =
    Number.isFinite(hoursParam) && hoursParam > 0 ? Math.min(hoursParam, MAX_HOURS) : DEFAULT_HOURS;

  const bucketParam = searchParams.get("bucket");
  let bucketSeconds = autoBucketSeconds(hours);
  if (bucketParam && bucketParam !== "auto") {
    const n = Number(bucketParam);
    if (Number.isFinite(n) && n > 0) {
      bucketSeconds = Math.min(MAX_BUCKET_S, Math.max(MIN_BUCKET_S, Math.round(n)));
    }
  }
  const includeCells = searchParams.get("cells") === "1";

  const from = new Date(Date.now() - hours * 60 * 60 * 1000);
  const bucketInterval = Prisma.sql`make_interval(secs => ${bucketSeconds})`;

  const [cellAgg, tempAgg, cellPer] = await Promise.all([
    prisma.$queryRaw<CellAggRow[]>`
      SELECT date_bin(${bucketInterval}, "recordedAt", ${from}) AS bucket,
             "packIndex",
             MIN("voltage") AS cellmin,
             MAX("voltage") AS cellmax,
             AVG("voltage") AS cellavg
      FROM "CellHistory"
      WHERE "deviceId" = ${id} AND "recordedAt" >= ${from}
      GROUP BY bucket, "packIndex"
      ORDER BY bucket ASC`,
    prisma.$queryRaw<TempAggRow[]>`
      SELECT date_bin(${bucketInterval}, "recordedAt", ${from}) AS bucket,
             "packIndex",
             AVG("temperature") AS tempavg,
             AVG("current") AS currentavg,
             AVG("power") AS poweravg,
             bool_or("balancerConnected") AS balanceron
      FROM "PackHistory"
      WHERE "deviceId" = ${id} AND "recordedAt" >= ${from}
      GROUP BY bucket, "packIndex"
      ORDER BY bucket ASC`,
    includeCells
      ? prisma.$queryRaw<CellPerRow[]>`
          SELECT date_bin(${bucketInterval}, "recordedAt", ${from}) AS bucket,
                 "packIndex",
                 "cellIndex",
                 AVG("voltage") AS vavg
          FROM "CellHistory"
          WHERE "deviceId" = ${id} AND "recordedAt" >= ${from}
          GROUP BY bucket, "packIndex", "cellIndex"
          ORDER BY bucket ASC`
      : Promise.resolve<CellPerRow[]>([]),
  ]);

  // Gabung agregasi cell + temp per (packIndex, bucket).
  type PackAcc = {
    index: number;
    buckets: Map<string, HistoryBucket>;
    cells: Map<number, { index: number; points: { t: string; vAvg: number }[] }>;
  };
  const packsMap = new Map<number, PackAcc>();

  function pack(index: number): PackAcc {
    let p = packsMap.get(index);
    if (!p) {
      p = { index, buckets: new Map(), cells: new Map() };
      packsMap.set(index, p);
    }
    return p;
  }
  function bucket(p: PackAcc, t: string): HistoryBucket {
    let b = p.buckets.get(t);
    if (!b) {
      b = {
        t,
        cellMin: null,
        cellMax: null,
        cellAvg: null,
        deltaMv: null,
        tempAvg: null,
        currentAvg: null,
        powerAvg: null,
        energyWh: null,
        balancerOn: false,
      };
      p.buckets.set(t, b);
    }
    return b;
  }

  for (const row of cellAgg) {
    const t = row.bucket.toISOString();
    const b = bucket(pack(row.packIndex), t);
    b.cellMin = row.cellmin;
    b.cellMax = row.cellmax;
    b.cellAvg = row.cellavg;
    b.deltaMv = Math.round((row.cellmax - row.cellmin) * 1000);
  }
  for (const row of tempAgg) {
    const t = row.bucket.toISOString();
    const b = bucket(pack(row.packIndex), t);
    b.tempAvg = row.tempavg;
    b.currentAvg = row.currentavg;
    b.powerAvg = row.poweravg;
    // Energi (Wh) dalam bucket: avg daya (W) × durasi bucket (detik) / 3600.
    b.energyWh = row.poweravg != null ? (row.poweravg * bucketSeconds) / 3600 : null;
    b.balancerOn = row.balanceron;
  }
  for (const row of cellPer) {
    const p = pack(row.packIndex);
    let cell = p.cells.get(row.cellIndex);
    if (!cell) {
      cell = { index: row.cellIndex, points: [] };
      p.cells.set(row.cellIndex, cell);
    }
    cell.points.push({ t: row.bucket.toISOString(), vAvg: row.vavg });
  }

  const packs = Array.from(packsMap.values())
    .sort((a, b) => a.index - b.index)
    .map((p) => ({
      index: p.index,
      buckets: Array.from(p.buckets.values()).sort((a, b) => a.t.localeCompare(b.t)),
      ...(includeCells
        ? {
            cells: Array.from(p.cells.values())
              .sort((a, b) => a.index - b.index)
              .map((c) => ({
                index: c.index,
                points: c.points.sort((a, b) => a.t.localeCompare(b.t)),
              })),
          }
        : {}),
    }));

  return NextResponse.json({
    from: from.toISOString(),
    to: new Date().toISOString(),
    hours,
    bucketSeconds,
    packs,
  });
}
