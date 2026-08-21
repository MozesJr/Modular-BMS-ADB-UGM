import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      expiresAt: true,
      createdAt: true,
      _count: { select: { devicesOwned: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(users);
}

export async function POST(req: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { name, email, password, role, expiresAt } = await req.json();

  if (!email || !password || password.length < 8) {
    return NextResponse.json(
      { error: "Email & password (min 8 karakter) wajib diisi" },
      { status: 400 }
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Email sudah terdaftar" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      role: role === "ADMIN" ? "ADMIN" : "USER",
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    },
    select: { id: true, name: true, email: true, role: true, expiresAt: true },
  });

  return NextResponse.json(user, { status: 201 });
}