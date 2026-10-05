import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertCanView, assertOwner, requireAuth } from "@/lib/authz";
import { err, parseJson, parseQuery, route } from "@/lib/http";
import { collaboratorRoleSchema, emailSchema } from "@/contracts/common";

type Ctx = { params: Promise<{ id: string }> };

const userSelect = { id: true, name: true, email: true } as const;

export const GET = route<Ctx>(async (_req, { params }) => {
  const session = await requireAuth();
  const { id } = await params;
  // Hanya anggota device (owner/collaborator) yang boleh melihat daftar collaborator.
  await assertCanView(id, session.user.id);

  const collaborators = await prisma.deviceCollaborator.findMany({
    where: { deviceId: id },
    include: { user: { select: userSelect } },
  });
  return NextResponse.json(collaborators);
});

const inviteBody = z.object({
  email: emailSchema,
  role: collaboratorRoleSchema.optional(),
});

// POST: owner undang user lain lewat email jadi collaborator
export const POST = route<Ctx>(async (req, { params }) => {
  const session = await requireAuth();
  const { id } = await params;
  await assertOwner(id, session.user.id, "Hanya owner device yang bisa menambah collaborator");

  const { email, role } = await parseJson(req, inviteBody);

  const targetUser = await prisma.user.findUnique({ where: { email } });
  if (!targetUser) throw err.notFound("User dengan email tersebut tidak ditemukan", "USER_NOT_FOUND");
  if (targetUser.id === session.user.id) throw err.badRequest("Tidak bisa menambahkan diri sendiri");

  try {
    const collaborator = await prisma.deviceCollaborator.create({
      data: { deviceId: id, userId: targetUser.id, role: role ?? "viewer" },
      include: { user: { select: userSelect } },
    });
    return NextResponse.json(collaborator, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw err.conflict("User sudah menjadi collaborator device ini", "ALREADY_COLLABORATOR");
    }
    throw e;
  }
});

const removeQuery = z.object({ userId: z.string().min(1, "userId wajib diisi") });

// DELETE: owner cabut akses collaborator — ?userId=xxx
export const DELETE = route<Ctx>(async (req, { params }) => {
  const session = await requireAuth();
  const { id } = await params;
  await assertOwner(id, session.user.id, "Hanya owner device yang bisa menghapus collaborator");

  const { userId } = parseQuery(req, removeQuery);
  await prisma.deviceCollaborator.deleteMany({ where: { deviceId: id, userId } });
  return NextResponse.json({ message: "Collaborator dihapus" });
});
