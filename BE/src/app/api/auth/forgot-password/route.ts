import { NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sendPasswordResetEmail } from "@/lib/email";
import { getClientIp } from "@/lib/client-ip";
import { runInBackground } from "@/lib/background";
import { log } from "@/lib/logger";
import { parseJson, route } from "@/lib/http";
import { enforceRateLimit, POLICIES } from "@/lib/rate-limit";
import { emailSchema } from "@/contracts/common";

const forgotBody = z.object({ email: emailSchema });

const RESET_TTL_MS = 60 * 60 * 1000; // 1 jam

async function createTokenAndSendEmail(email: string) {
  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    log.error("forgot_password.app_url_missing"); // fail fast: tautan reset tidak bisa dibuat
    return;
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return;

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  // Satu token aktif per user: token lama (belum dipakai) dibatalkan saat yang baru dibuat.
  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
    prisma.passwordResetToken.create({
      data: { tokenHash, userId: user.id, expiresAt: new Date(Date.now() + RESET_TTL_MS) },
    }),
  ]);

  await sendPasswordResetEmail(user.email, `${appUrl}/reset-password?token=${rawToken}`);
}

// Respons SELALU sama dan segera (tanpa menyentuh DB/SMTP di jalur request), sehingga tidak ada
// perbedaan isi maupun waktu antara email terdaftar dan tidak. Pekerjaan sebenarnya jalan di latar belakang.
export const POST = route(async (req) => {
  const { email } = await parseJson(req, forgotBody);

  enforceRateLimit([
    { policy: POLICIES.forgotIp, id: getClientIp(req) },
    { policy: POLICIES.forgotEmail, id: email.toLowerCase() },
  ]);

  runInBackground("email", "forgot-password", () => createTokenAndSendEmail(email));

  return NextResponse.json({ message: "Kalau email terdaftar, link reset sudah dikirim." });
});
