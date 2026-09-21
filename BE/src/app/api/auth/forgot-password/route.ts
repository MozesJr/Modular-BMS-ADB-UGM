import { NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sendPasswordResetEmail } from "@/lib/email";
import { parseJson, route } from "@/lib/http";
import { emailSchema } from "@/contracts/common";

const forgotBody = z.object({ email: emailSchema });

export const POST = route(async (req) => {
  const { email } = await parseJson(req, forgotBody);

  // Selalu balikin response yang sama, biar nggak bocorin apakah email terdaftar
  const genericResponse = NextResponse.json({
    message: "Kalau email terdaftar, link reset sudah dikirim.",
  });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return genericResponse;

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  await prisma.passwordResetToken.create({
    data: {
      tokenHash,
      userId: user.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 jam
    },
  });

  const resetUrl = `${process.env.APP_URL}/reset-password?token=${rawToken}`;
  await sendPasswordResetEmail(user.email, resetUrl);

  return genericResponse;
});
