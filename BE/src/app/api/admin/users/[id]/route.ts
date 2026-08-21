import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      expiresAt: true,
      createdAt: true,
      devicesOwned: { select: { id: true, name: true, verified: true } },
    },
  });

  if (!user) return NextResponse.json({ error: "User tidak ditemukan" }, { status: 404 });
  return NextResponse.json(user);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { name, role, expiresAt, password } = await req.json();

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (role === "ADMIN" || role === "USER") data.role = role;
  if (expiresAt !== undefined) data.expiresAt = expiresAt ? new Date(expiresAt) : null;
  if (password) {
    if (password.length < 8) {
      return NextResponse.json({ error: "Password minimal 8 karakter" }, { status: 400 });
    }
    data.passwordHash = await bcrypt.hash(password, 12);
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, name: true, email: true, role: true, expiresAt: true },
  });

  return NextResponse.json(user);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  const deviceCount = await prisma.device.count({ where: { ownerId: id } });
  if (deviceCount > 0) {
    return NextResponse.json(
      { error: `User masih memiliki ${deviceCount} device. Pindahkan atau hapus device dulu.` },
      { status: 409 }
    );
  }

  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ message: "User dihapus" });
}