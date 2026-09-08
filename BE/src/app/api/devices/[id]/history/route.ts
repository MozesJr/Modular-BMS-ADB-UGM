// BE/src/app/api/devices/[id]/history/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/authz";

const DEFAULT_HOURS = 24;
const MAX_HOURS = 24 * 30; // batas atas 30 hari biar query gak sembarangan berat

// GET: time-series history (temperature per pack, voltage per cell) buat grafik tren.
// Query: ?hours=24 (default 24, kalau melebihi MAX_HOURS di-clamp)
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const device = await prisma.device.findUnique({
    where: { id },
    include: { collaborators: true },
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
  const hours = Number.isFinite(hoursParam) && hoursParam > 0
    ? Math.min(hoursParam, MAX_HOURS)
    : DEFAULT_HOURS;

  const from = new Date(Date.now() - hours * 60 * 60 * 1000);

  const [packRows, cellRows] = await Promise.all([
    prisma.packHistory.findMany({
      where: { deviceId: id, recordedAt: { gte: from } },
      orderBy: { recordedAt: "asc" },
      select: { packIndex: true, temperature: true, balancerConnected: true, recordedAt: true },
    }),
    prisma.cellHistory.findMany({
      where: { deviceId: id, recordedAt: { gte: from } },
      orderBy: { recordedAt: "asc" },
      select: { packIndex: true, cellIndex: true, voltage: true, recordedAt: true },
    }),
  ]);

  // Group per pack index, cell history di-nest lagi per cell index dalam pack itu.
  const packsMap = new Map<
    number,
    {
      index: number;
      temperature: { recordedAt: Date; temperature: number | null; balancerConnected: boolean }[];
      cells: Map<number, { recordedAt: Date; voltage: number }[]>;
    }
  >();

  for (const row of packRows) {
    if (!packsMap.has(row.packIndex)) {
      packsMap.set(row.packIndex, { index: row.packIndex, temperature: [], cells: new Map() });
    }
    packsMap.get(row.packIndex)!.temperature.push({
      recordedAt: row.recordedAt,
      temperature: row.temperature,
      balancerConnected: row.balancerConnected,
    });
  }

  for (const row of cellRows) {
    if (!packsMap.has(row.packIndex)) {
      packsMap.set(row.packIndex, { index: row.packIndex, temperature: [], cells: new Map() });
    }
    const pack = packsMap.get(row.packIndex)!;
    if (!pack.cells.has(row.cellIndex)) pack.cells.set(row.cellIndex, []);
    pack.cells.get(row.cellIndex)!.push({ recordedAt: row.recordedAt, voltage: row.voltage });
  }

  const packs = Array.from(packsMap.values())
    .sort((a, b) => a.index - b.index)
    .map((pack) => ({
      index: pack.index,
      temperature: pack.temperature,
      cells: Array.from(pack.cells.entries())
        .sort(([a], [b]) => a - b)
        .map(([index, voltage]) => ({ index, voltage })),
    }));

  return NextResponse.json({ from, to: new Date(), hours, packs });
}
