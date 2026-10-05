import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/authz";
import { err, parseJson, route } from "@/lib/http";
import { requireDeviceAccess } from "@/lib/device-access";
import { enforceRateLimit, POLICIES } from "@/lib/rate-limit";
import { toCollaboratorDto } from "@/lib/device-dto";
import { AddCollaboratorRequestSchema } from "@/contracts/schemas";

type Ctx = { params: Promise<{ id: string }> };

const SELECT = { userId: true, role: true, addedAt: true, user: { select: { name: true, email: true } } } as const;

// GET — semua anggota boleh melihat daftar; EMAIL hanya terlihat oleh owner (selain itu null).
export const GET = route<Ctx>(async (_req, { params }) => {
  const { user } = await requireAuth();
  const { id } = await params;
  const { role } = await requireDeviceAccess(id, user.id, "view");
  const rows = await prisma.deviceCollaborator.findMany({ where: { deviceId: id }, orderBy: { addedAt: "asc" }, select: SELECT });
  return NextResponse.json({ items: rows.map((c) => toCollaboratorDto(c, role === "owner")) });
});

// POST — owner mengundang user terdaftar lewat email sebagai viewer/editor.
export const POST = route<Ctx>(async (req, { params }) => {
  const { user } = await requireAuth();
  const { id } = await params;
  await requireDeviceAccess(id, user.id, "owner");
  enforceRateLimit([{ policy: POLICIES.collabAddUser, id: user.id }]); // juga membatasi enumerasi email
  const { email, role } = await parseJson(req, AddCollaboratorRequestSchema);

  const target = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!target) throw err.notFound("User dengan email tersebut tidak ditemukan", "USER_NOT_FOUND");
  if (target.id === user.id) throw err.badRequest("Tidak bisa menambahkan diri sendiri", [{ path: "email", message: "itu akun Anda sendiri" }]);

  try {
    const row = await prisma.deviceCollaborator.create({ data: { deviceId: id, userId: target.id, role }, select: SELECT });
    return NextResponse.json(toCollaboratorDto(row, true), { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw err.conflict("User sudah menjadi collaborator device ini", "ALREADY_COLLABORATOR");
    }
    throw e;
  }
});
