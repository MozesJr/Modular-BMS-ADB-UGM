// BE/src/app/api/devices/[id]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, roleOf } from "@/lib/authz";
import { err, route } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  const session = await requireAuth();
  const { id } = await params;

  const device = await prisma.device.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      packs: { include: { cells: true } },
      collaborators: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  });

  if (!device) throw err.notFound("Device tidak ditemukan", "DEVICE_NOT_FOUND");
  if (!roleOf(device, session.user.id)) throw err.forbidden();

  return NextResponse.json(device);
});
