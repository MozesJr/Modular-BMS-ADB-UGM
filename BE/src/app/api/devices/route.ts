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
      packs: { include: { cells: true } },
      collaborators: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  });

  return NextResponse.json(devices);
}

// POST: user daftarin device baru pakai ID/lisensi dari perangkat fisik — status verified=false sampai admin approve
export async function POST(req: Request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, name } = await req.json();

  if (!id) {
    return NextResponse.json({ error: "Device ID/lisensi wajib diisi" }, { status: 400 });
  }

  const existing = await prisma.device.findUnique({ where: { id } });
  if (existing) {
    return NextResponse.json({ error: "Device ID sudah terdaftar" }, { status: 409 });
  }

  const device = await prisma.device.create({
    data: {
      id,
      name,
      ownerId: session.user.id,
      verified: false,
    },
  });

  return NextResponse.json(device, { status: 201 });
}