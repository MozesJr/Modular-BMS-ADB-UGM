// BE/src/app/api/admin/devices/[id]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { err, route } from "@/lib/http";
import { invalidateDevice } from "@/lib/ws-hub";

export const DELETE = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  await requireAdmin();
  const { id } = await params;

  const device = await prisma.device.findUnique({ where: { id } });
  if (!device) throw err.notFound("Device tidak ditemukan", "DEVICE_NOT_FOUND");

  await prisma.device.delete({ where: { id } });
  invalidateDevice(id);
  return NextResponse.json({ message: "Device dihapus" });
});
