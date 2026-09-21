import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { err, parseJson, route } from "@/lib/http";
import { emailSchema, expiresAtSchema, nameSchema, newPasswordSchema, roleSchema } from "@/contracts/common";

export const GET = route(async () => {
  await requireAdmin();

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
});

const createUserBody = z.object({
  name: nameSchema.optional(),
  email: emailSchema,
  password: newPasswordSchema,
  role: roleSchema.optional(),
  expiresAt: expiresAtSchema.optional(),
});

export const POST = route(async (req) => {
  await requireAdmin();
  const { name, email, password, role, expiresAt } = await parseJson(req, createUserBody);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw err.conflict("Email sudah terdaftar", "EMAIL_TAKEN");

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { name, email, passwordHash, role: role ?? "USER", expiresAt: expiresAt ?? null },
    select: { id: true, name: true, email: true, role: true, expiresAt: true },
  });

  return NextResponse.json(user, { status: 201 });
});
