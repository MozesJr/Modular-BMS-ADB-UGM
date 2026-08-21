// BE/src/app/api/devices/[id]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/authz";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  if (!device) {
    return NextResponse.json({ error: "Device tidak ditemukan" }, { status: 404 });
  }

  const isOwner = device.ownerId === session.user.id;
  const isCollaborator = device.collaborators.some((c) => c.userId === session.user.id);

  if (!isOwner && !isCollaborator) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(device);
}