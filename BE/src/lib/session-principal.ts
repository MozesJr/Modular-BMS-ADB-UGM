import { decodeJwt } from "jose";
import { decode } from "next-auth/jwt";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkSessionAgainstUser } from "@/lib/session-check";
import { verifyAccessToken } from "@/lib/tokens";

// Verifikasi kredensial + pembacaan user dari DB TANPA impor Next (next/headers, next/server, auth()).
// Dipakai bersama oleh authz.ts (route REST) dan custom server /ws. Modul yang dimuat custom server TIDAK BOLEH
// menyentuh API Next berbasis request: lihat src/lib/server-imports.test.ts. Sengaja tidak memakai ApiError/http.ts
// (next/server); AccessSecretError dibiarkan naik dan dipetakan pemanggil (authz.ts -> 500, ws-auth -> 503).

export type AuthSession = {
  user: {
    id: string;
    role: Role;
    expiresAt: string | null;
    tokenVersion: number;
    name?: string | null;
    email?: string | null;
  };
};

export const USER_SELECT = { id: true, role: true, expiresAt: true, tokenVersion: true, name: true, email: true } as const;

export function toAuthSession(user: {
  id: string;
  role: Role;
  expiresAt: Date | null;
  tokenVersion: number;
  name: string | null;
  email: string;
}): AuthSession {
  return {
    user: {
      id: user.id,
      role: user.role,
      expiresAt: user.expiresAt ? user.expiresAt.toISOString() : null,
      tokenVersion: user.tokenVersion,
      name: user.name,
      email: user.email,
    },
  };
}

// Principal dari access token (Authorization: Bearer). null bila token/sesi tidak valid; AccessSecretError bila
// konfigurasi server salah.
export async function principalFromAccessToken(token: string): Promise<AuthSession | null> {
  const claims = await verifyAccessToken(token);
  if (!claims) return null;
  const user = await prisma.user.findUnique({ where: { id: claims.userId }, select: USER_SELECT });
  if (!checkSessionAgainstUser({ id: claims.userId, tokenVersion: claims.tokenVersion }, user).ok || !user) return null;
  return toAuthSession(user);
}

// Principal dari id + tokenVersion yang dibaca dari JWT sesi Auth.js (cookie).
export async function principalFromSessionClaims(id: string, tokenVersion: number | undefined): Promise<AuthSession | null> {
  const user = await prisma.user.findUnique({ where: { id }, select: USER_SELECT });
  if (!checkSessionAgainstUser({ id, tokenVersion }, user).ok || !user) return null;
  return toAuthSession(user);
}

export interface SessionClaims {
  userId: string;
  tokenVersion: number;
  expSec: number | null;
}

// Klaim dari access token (+ exp) untuk handshake WS.
export async function verifyBearerClaims(token: string): Promise<SessionClaims | null> {
  const claims = await verifyAccessToken(token);
  if (!claims) return null;
  const exp = decodeJwt(token).exp;
  return { userId: claims.userId, tokenVersion: claims.tokenVersion, expSec: typeof exp === "number" ? exp : null };
}

// Dekode cookie sesi Auth.js (JWE). Secret = NEXTAUTH_SECRET, sama dengan lib/auth.ts. `salt` = nama cookie.
export async function verifyCookieClaims(value: string, salt: string): Promise<SessionClaims | null> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET belum diset");
  let token;
  try {
    token = await decode({ token: value, secret, salt });
  } catch {
    return null; // cookie rusak / bukan milik kita / kedaluwarsa
  }
  if (!token || typeof token.id !== "string") return null;
  return { userId: token.id, tokenVersion: token.tv ?? 0, expSec: typeof token.exp === "number" ? token.exp : null };
}

export function loadSessionUser(userId: string) {
  return prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, expiresAt: true, tokenVersion: true } });
}
