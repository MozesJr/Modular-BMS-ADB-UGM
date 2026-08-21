// BE/src/app/api/admin/devices/[id]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  const device = await prisma.device.findUnique({ where: { id } });
  if (!device) {
    return NextResponse.json({ error: "Device tidak ditemukan" }, { status: 404 });
  }

  await prisma.device.delete({ where: { id } });
  return NextResponse.json({ message: "Device dihapus" });
}