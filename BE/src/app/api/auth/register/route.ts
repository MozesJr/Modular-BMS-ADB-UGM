import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getClientIp } from "@/lib/client-ip";
import { parseJson, route } from "@/lib/http";
import { enforceRateLimit, POLICIES } from "@/lib/rate-limit";
import { emailSchema, nameSchema, newPasswordSchema } from "@/contracts/common";

const registerBody = z.object({
  name: nameSchema.optional(),
  email: emailSchema,
  password: newPasswordSchema,
});

// Registrasi terbuka, tapi:
//  - dibatasi per IP,
//  - respons NETRAL: sama persis baik email baru maupun sudah terdaftar (tidak membocorkan keberadaan akun),
//  - hash bcrypt selalu dihitung sehingga waktu respons tidak membedakan kedua kasus.
// Klien lalu login seperti biasa; bila email sudah terdaftar dengan password lain, login gagal wajar.
export const POST = route(async (req) => {
  enforceRateLimit([{ policy: POLICIES.registerIp, id: getClientIp(req) }]);
  const { name, email, password } = await parseJson(req, registerBody);

  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });

  if (!existing) {
    try {
      await prisma.user.create({ data: { name, email, passwordHash } });
    } catch (e) {
      // Balapan dua registrasi email sama: yang kalah diperlakukan sama seperti "sudah ada".
      if (!(e instanceof Error && "code" in e && (e as { code?: string }).code === "P2002")) throw e;
    }
  }

  return NextResponse.json(
    { message: "Permintaan diterima. Jika email belum terdaftar, akun dibuat dan Anda bisa masuk." },
    { status: 202 },
  );
});
