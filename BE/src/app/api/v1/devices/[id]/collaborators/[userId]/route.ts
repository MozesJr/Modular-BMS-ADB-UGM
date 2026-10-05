import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/authz";
import { err, parseJson, route } from "@/lib/http";
import { requireDeviceAccess } from "@/lib/device-access";
import { toCollaboratorDto } from "@/lib/device-dto";
import { UpdateCollaboratorRequestSchema } from "@/contracts/schemas";

type Ctx = { params: Promise<{ id: string; userId: string }> };

// PATCH — owner mengubah peran collaborator (viewer <-> editor).
export const PATCH = route<Ctx>(async (req, { params }) => {
  const { user } = await requireAuth();
  const { id, userId } = await params;
  await requireDeviceAccess(id, user.id, "owner");
  const { role } = await parseJson(req, UpdateCollaboratorRequestSchema);

  const existing = await prisma.deviceCollaborator.findUnique({ where: { deviceId_userId: { deviceId: id, userId } }, select: { id: true } });
  if (!existing) throw err.notFound("Collaborator tidak ditemukan", "COLLABORATOR_NOT_FOUND");
  const row = await prisma.deviceCollaborator.update({
    where: { id: existing.id },
    data: { role },
    select: { userId: true, role: true, addedAt: true, user: { select: { name: true, email: true } } },
  });
  return NextResponse.json(toCollaboratorDto(row, true));
});

// DELETE — owner mencabut siapa pun; collaborator boleh KELUAR sendiri (userId = dirinya). Selain itu 403.
export const DELETE = route<Ctx>(async (_req, { params }) => {
  const { user } = await requireAuth();
  const { id, userId } = await params;
  const { role } = await requireDeviceAccess(id, user.id, "view");
  if (role !== "owner" && userId !== user.id) throw err.forbidden("Hanya owner yang boleh mencabut collaborator lain");

  const result = await prisma.deviceCollaborator.deleteMany({ where: { deviceId: id, userId } });
  if (result.count === 0) throw err.notFound("Collaborator tidak ditemukan", "COLLABORATOR_NOT_FOUND");
  return new Response(null, { status: 204 });
});
