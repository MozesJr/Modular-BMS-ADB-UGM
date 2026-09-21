import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { err, parseJson, route } from "@/lib/http";
import { emailSchema, nameSchema, newPasswordSchema } from "@/contracts/common";

const registerBody = z.object({
  name: nameSchema.optional(),
  email: emailSchema,
  password: newPasswordSchema,
});

export const POST = route(async (req) => {
  const { name, email, password } = await parseJson(req, registerBody);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw err.conflict("Email sudah terdaftar", "EMAIL_TAKEN");

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { name, email, passwordHash },
    select: { id: true, email: true, name: true },
  });

  return NextResponse.json(user, { status: 201 });
});
