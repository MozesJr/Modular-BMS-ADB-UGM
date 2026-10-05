import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { err, parseJson, route } from "@/lib/http";
import { expiresAtSchema, nameSchema, newPasswordSchema, roleSchema } from "@/contracts/common";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  await requireAdmin();
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

  if (!user) throw err.notFound("User tidak ditemukan", "USER_NOT_FOUND");
  return NextResponse.json(user);
});

const patchUserBody = z.object({
  name: nameSchema.nullable().optional(),
  role: roleSchema.optional(),
  expiresAt: expiresAtSchema.optional(),
  password: newPasswordSchema.optional().or(z.literal("").transform(() => undefined)),
});

export const PATCH = route<Ctx>(async (req, { params }) => {
  await requireAdmin();
  const { id } = await params;
  const { name, role, expiresAt, password } = await parseJson(req, patchUserBody);

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (role !== undefined) data.role = role;
  if (expiresAt !== undefined) data.expiresAt = expiresAt;
  if (password) {
    data.passwordHash = await bcrypt.hash(password, 12);
    data.tokenVersion = { increment: 1 }; // paksa logout semua sesi user ini
  }

  // P2025 (id tidak ada) dipetakan route() ke 404
  const user = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, name: true, email: true, role: true, expiresAt: true },
  });

  return NextResponse.json(user);
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  await requireAdmin();
  const { id } = await params;

  const deviceCount = await prisma.device.count({ where: { ownerId: id } });
  if (deviceCount > 0) {
    throw err.conflict(
      `User masih memiliki ${deviceCount} device. Pindahkan atau hapus device dulu.`,
      "USER_HAS_DEVICES",
    );
  }

  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ message: "User dihapus" });
});
