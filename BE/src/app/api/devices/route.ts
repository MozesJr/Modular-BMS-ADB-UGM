import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/authz";

// GET: device milik user (owner ATAU collaborator)
export async function GET() {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const devices = await prisma.device.findMany({
    where: {
      OR: [
        { ownerId: session.user.id },
        { collaborators: { some: { userId: session.user.id } } },
      ],
    },
    include: {
      packs: {
        orderBy: { index: "asc" },
        include: { cells: { orderBy: { index: "asc" } } },
      },
      collaborators: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  });

  return NextResponse.json(devices);
}

// POST: user daftarin device baru pakai ID/lisensi dari perangkat fisik (serialNumber) —
// status verified=false sampai admin approve. Kalau device itu udah pernah publish data
// lewat MQTT sebelum diklaim siapapun (auto-provisioned, ownerId masih null), klaim
// row yang sudah ada itu alih-alih bikin duplikat.
export async function POST(req: Request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { serialNumber, name } = await req.json();

  if (!serialNumber) {
    return NextResponse.json({ error: "Device ID/lisensi wajib diisi" }, { status: 400 });
  }

  const existing = await prisma.device.findUnique({ where: { serialNumber } });

  if (existing) {
    if (existing.ownerId) {
      return NextResponse.json({ error: "Device ID sudah terdaftar" }, { status: 409 });
    }

    const claimed = await prisma.device.update({
      where: { id: existing.id },
      data: { ownerId: session.user.id, name: name ?? existing.name },
    });
    return NextResponse.json(claimed, { status: 200 });
  }

  const device = await prisma.device.create({
    data: {
      serialNumber,
      name,
      ownerId: session.user.id,
      verified: false,
    },
  });

  return NextResponse.json(device, { status: 201 });
}