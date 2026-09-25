// BE/src/app/api/devices/summary/route.ts
//
// Ringkasan fleet untuk kartu Dashboard: metadata + sparkline (delta & power) per device,
// downsampled (≤ ~60 titik/device). Menghindari N request /history per device.
//
// AKSES: identik dengan GET /api/devices — owner ATAU collaborator. Device yang bukan milik
// user tidak pernah dikembalikan (dibatasi di where clause query metadata; query agregasi
// hanya menerima id dari daftar itu).
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/authz";
import { computeEnergyToday } from "@/lib/energy";

const DEFAULT_HOURS = 6;
const MAX_HOURS = 24 * 7;
const MAX_POINTS = 60;

type DeltaRow = { deviceId: string; bucket: Date; mn: number; mx: number };
type PowerRow = { deviceId: string; bucket: Date; avgpower: number | null };

export async function GET(req: Request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const hoursParam = Number(searchParams.get("hours"));
  const hours = Number.isFinite(hoursParam) && hoursParam > 0 ? Math.min(hoursParam, MAX_HOURS) : DEFAULT_HOURS;
  const from = new Date(Date.now() - hours * 60 * 60 * 1000);
  // Bucket dipilih agar titik ≤ MAX_POINTS.
  const bucketSeconds = Math.max(60, Math.ceil((hours * 3600) / MAX_POINTS));
  const bucketInterval = Prisma.sql`make_interval(secs => ${bucketSeconds})`;

  // 1) Metadata device yang bisa diakses (owner ATAU collaborator) — SAMA dengan GET /api/devices.
  const devices = await prisma.device.findMany({
    where: {
      OR: [
        { ownerId: session.user.id },
        { collaborators: { some: { userId: session.user.id } } },
      ],
    },
    select: {
      id: true,
      serialNumber: true,
      name: true,
      verified: true,
      lastSeen: true,
      packs: { select: { _count: { select: { cells: true } } } },
    },
  });

  const ids = devices.map((d) => d.id);
  const packCountById = new Map(devices.map((d) => [d.id, d.packs.length]));

  // 2) Dua query GROUP BY (device, bucket) — delta cell & rata-rata daya — plus energi hari ini
  // (sejak 00:00 WIB, lihat lib/energy.ts). Hanya untuk id di atas.
  let deltaRows: DeltaRow[] = [];
  let powerRows: PowerRow[] = [];
  let energyToday: Awaited<ReturnType<typeof computeEnergyToday>> = { sinceUtc: new Date().toISOString(), byDevice: new Map() };
  if (ids.length > 0) {
    [deltaRows, powerRows, energyToday] = await Promise.all([
      prisma.$queryRaw<DeltaRow[]>`
        SELECT "deviceId", date_bin(${bucketInterval}, "recordedAt", ${from}) AS bucket,
               MIN("voltage") AS mn, MAX("voltage") AS mx
        FROM "CellHistory"
        WHERE "deviceId" IN (${Prisma.join(ids)}) AND "recordedAt" >= ${from}
        GROUP BY "deviceId", bucket
        ORDER BY bucket ASC`,
      prisma.$queryRaw<PowerRow[]>`
        SELECT "deviceId", date_bin(${bucketInterval}, "recordedAt", ${from}) AS bucket,
               AVG("power") AS avgpower
        FROM "PackHistory"
        WHERE "deviceId" IN (${Prisma.join(ids)}) AND "recordedAt" >= ${from}
        GROUP BY "deviceId", bucket
        ORDER BY bucket ASC`,
      computeEnergyToday(ids),
    ]);
  }

  // Gabung per device → spark[{ t, deltaMv, powerW }].
  type Point = { t: string; deltaMv: number | null; powerW: number | null };
  const sparkByDevice = new Map<string, Map<string, Point>>();
  const point = (deviceId: string, t: string): Point => {
    let m = sparkByDevice.get(deviceId);
    if (!m) {
      m = new Map();
      sparkByDevice.set(deviceId, m);
    }
    let p = m.get(t);
    if (!p) {
      p = { t, deltaMv: null, powerW: null };
      m.set(t, p);
    }
    return p;
  };

  for (const row of deltaRows) {
    point(row.deviceId, row.bucket.toISOString()).deltaMv = Math.round((row.mx - row.mn) * 1000);
  }
  for (const row of powerRows) {
    // Total daya device ≈ packCount × rata-rata daya pack di bucket.
    const packCount = packCountById.get(row.deviceId) ?? 1;
    point(row.deviceId, row.bucket.toISOString()).powerW = row.avgpower != null ? row.avgpower * packCount : null;
  }

  const result = devices.map((d) => {
    const cellCount = d.packs.reduce((sum, p) => sum + p._count.cells, 0);
    const spark = Array.from(sparkByDevice.get(d.id)?.values() ?? []).sort((a, b) => a.t.localeCompare(b.t));
    const energy = energyToday.byDevice.get(d.id);
    return {
      id: d.id,
      serialNumber: d.serialNumber,
      name: d.name,
      verified: d.verified,
      lastSeen: d.lastSeen ? d.lastSeen.toISOString() : null,
      packCount: d.packs.length,
      cellCount,
      spark,
      energyTodayInWh: energy?.energyInWh ?? 0,
      energyTodayOutWh: energy?.energyOutWh ?? 0,
    };
  });

  return NextResponse.json({ hours, bucketSeconds, energyToday: { sinceUtc: energyToday.sinceUtc }, devices: result });
}
