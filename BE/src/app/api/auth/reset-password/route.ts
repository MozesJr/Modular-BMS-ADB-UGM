import { NextResponse } from "next/server";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ApiError, parseJson, route } from "@/lib/http";
import { getClientIp } from "@/lib/client-ip";
import { enforceRateLimit, POLICIES } from "@/lib/rate-limit";
import { newPasswordSchema } from "@/contracts/common";

const resetBody = z.object({
  token: z.string().min(1, "Token wajib diisi").max(256),
  newPassword: newPasswordSchema,
});

export const POST = route(async (req) => {
  enforceRateLimit([{ policy: POLICIES.resetIp, id: getClientIp(req) }]);
  const { token, newPassword } = await parseJson(req, resetBody);

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    throw new ApiError(400, "INVALID_RESET_TOKEN", "Token tidak valid atau sudah kedaluwarsa");
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await prisma.$transaction([
    // tokenVersion++ -> semua sesi web/mobile yang sudah ada langsung tidak berlaku
    prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    }),
    prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { usedAt: new Date() } }),
    // token reset lain milik user ini (belum dipakai) ikut dibatalkan
    prisma.passwordResetToken.deleteMany({ where: { userId: resetToken.userId, usedAt: null } }),
  ]);

  return NextResponse.json({ message: "Password berhasil direset" });
});
