import type { Role } from "@prisma/client";

// Logika murni validasi sesi terhadap baris User di DB (dites di session-check.test.ts).
export type DbUserForSession = {
  id: string;
  role: Role;
  expiresAt: Date | null;
  tokenVersion: number;
};

export type SessionClaims = { id: string; tokenVersion?: number };

export type SessionCheck =
  | { ok: true }
  | { ok: false; reason: "user_missing" | "expired" | "token_version_mismatch" };

export function checkSessionAgainstUser(
  claims: SessionClaims,
  user: DbUserForSession | null,
  now: number = Date.now(),
): SessionCheck {
  if (!user) return { ok: false, reason: "user_missing" };
  if (user.expiresAt && user.expiresAt.getTime() <= now) return { ok: false, reason: "expired" };
  // JWT lama (sebelum ada tokenVersion) dianggap versi 0
  if ((claims.tokenVersion ?? 0) !== user.tokenVersion) return { ok: false, reason: "token_version_mismatch" };
  return { ok: true };
}
