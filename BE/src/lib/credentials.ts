import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { DUMMY_PASSWORD_HASH } from "@/lib/dummy-hash";

// Verifikasi email+password, dipakai bersama oleh login web (Auth.js) dan login token mobile supaya aturannya SAMA.
export type CredentialResult =
  | { ok: true; user: { id: string; email: string; name: string | null; role: "USER" | "ADMIN"; expiresAt: Date | null; tokenVersion: number } }
  | { ok: false; reason: "invalid" | "expired" };

export async function verifyCredentials(email: string, password: string): Promise<CredentialResult> {
  const user = await prisma.user.findUnique({ where: { email } });
  // Selalu jalankan bcrypt (hash dummy bila user tak ada) -> waktu respons tidak membedakan email terdaftar/tidak.
  const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || !valid) return { ok: false, reason: "invalid" };
  if (user.expiresAt && user.expiresAt < new Date()) return { ok: false, reason: "expired" };
  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      expiresAt: user.expiresAt,
      tokenVersion: user.tokenVersion,
    },
  };
}
