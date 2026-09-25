import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/authz";
import { err, parseJson, route } from "@/lib/http";
import { deviceNameSchema, serialNumberSchema } from "@/contracts/common";

// GET: device milik user (owner ATAU collaborator)
export const GET = route(async () => {
  const session = await requireAuth();

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
});

const createDeviceBody = z.object({
  serialNumber: serialNumberSchema,
  name: deviceNameSchema.optional(),
});

// POST: user daftarin device baru pakai ID/lisensi dari perangkat fisik (serialNumber) —
// status verified=false sampai admin approve. Kalau device itu udah pernah publish data
// lewat MQTT sebelum diklaim siapapun (auto-provisioned, ownerId masih null), klaim
// row yang sudah ada itu alih-alih bikin duplikat.
export const POST = route(async (req) => {
  const session = await requireAuth();
  const { serialNumber, name } = await parseJson(req, createDeviceBody);

  const existing = await prisma.device.findUnique({ where: { serialNumber } });

  if (existing) {
    if (existing.ownerId) throw err.conflict("Device ID sudah terdaftar", "DEVICE_ALREADY_CLAIMED");

    // Klaim atomik: hanya berhasil bila ownerId MASIH null (dua user tidak bisa mengklaim bersamaan).
    const claim = await prisma.device.updateMany({
      where: { id: existing.id, ownerId: null },
      data: { ownerId: session.user.id, ...(name ? { name } : {}) },
    });
    if (claim.count === 0) throw err.conflict("Device ID sudah terdaftar", "DEVICE_ALREADY_CLAIMED");

    const claimed = await prisma.device.findUniqueOrThrow({ where: { id: existing.id } });
    return NextResponse.json(claimed, { status: 200 });
  }

  const device = await prisma.device.create({
    data: { serialNumber, name, ownerId: session.user.id, verified: false },
  });

  return NextResponse.json(device, { status: 201 });
});
