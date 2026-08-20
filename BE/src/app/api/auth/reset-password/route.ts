import { NextResponse } from "next/server";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const { token, newPassword } = await req.json();

  if (!token || !newPassword || newPassword.length < 8) {
    return NextResponse.json(
      { error: "Token & password baru (min 8 karakter) wajib diisi" },
      { status: 400 }
    );
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    return NextResponse.json(
      { error: "Token tidak valid atau sudah kedaluwarsa" },
      { status: 400 }
    );
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await prisma.$transaction([
    prisma.user.update({ where: { id: resetToken.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { usedAt: new Date() } }),
  ]);

  return NextResponse.json({ message: "Password berhasil direset" });
}