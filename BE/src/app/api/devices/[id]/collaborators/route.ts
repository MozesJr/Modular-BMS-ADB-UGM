import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertCanView, assertOwner, requireAuth } from "@/lib/authz";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  // Sebelumnya hanya cek "sudah login" -> user mana pun bisa membaca collaborator device lain (IDOR).
  const access = await assertCanView(id, session.user.id);
  if (!access.ok) return access.response;

  const collaborators = await prisma.deviceCollaborator.findMany({
    where: { deviceId: id },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  return NextResponse.json(collaborators);
}

// POST: owner undang user lain lewat email jadi collaborator
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const ownerCheck = await assertOwner(id, session.user.id, "Hanya owner device yang bisa menambah collaborator");
  if (!ownerCheck.ok) return ownerCheck.response;

  const { email, role } = await req.json();
  if (!email) return NextResponse.json({ error: "Email wajib diisi" }, { status: 400 });

  const targetUser = await prisma.user.findUnique({ where: { email } });
  if (!targetUser) {
    return NextResponse.json({ error: "User dengan email tersebut tidak ditemukan" }, { status: 404 });
  }
  if (targetUser.id === session.user.id) {
    return NextResponse.json({ error: "Tidak bisa menambahkan diri sendiri" }, { status: 400 });
  }

  const collaborator = await prisma.deviceCollaborator.create({
    data: {
      deviceId: id,
      userId: targetUser.id,
      role: role === "editor" ? "editor" : "viewer",
    },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  return NextResponse.json(collaborator, { status: 201 });
}

// DELETE: owner cabut akses collaborator — ?userId=xxx
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const ownerCheck = await assertOwner(id, session.user.id, "Hanya owner device yang bisa menghapus collaborator");
  if (!ownerCheck.ok) return ownerCheck.response;

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId wajib diisi" }, { status: 400 });

  await prisma.deviceCollaborator.deleteMany({ where: { deviceId: id, userId } });
  return NextResponse.json({ message: "Collaborator dihapus" });
}