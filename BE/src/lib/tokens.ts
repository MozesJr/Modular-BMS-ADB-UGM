import { createHash, randomBytes, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { checkAccessSecret } from "@/lib/env-check";

// Token akses (JWT HS256, umur pendek) + refresh token opaque. Lihat docs/API-GUIDE.md untuk alurnya.

export const ISSUER = "bms-api";
export const AUDIENCE = "bms-api";

const intEnv = (name: string, fallback: number) => {
  const v = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const accessTtlSec = () => intEnv("ACCESS_TOKEN_TTL_SEC", 15 * 60);
export const refreshTtlSec = () => intEnv("REFRESH_TOKEN_TTL_SEC", 30 * 24 * 3600);
export const refreshFamilyMaxSec = () => intEnv("REFRESH_FAMILY_MAX_SEC", 90 * 24 * 3600);

export class AccessSecretError extends Error {}

function key(): Uint8Array {
  const problem = checkAccessSecret();
  if (problem) throw new AccessSecretError(problem);
  return new TextEncoder().encode(process.env.JWT_ACCESS_SECRET!);
}

export interface AccessClaims {
  userId: string;
  tokenVersion: number;
  familyId: string;
}

export async function signAccessToken(claims: AccessClaims, nowSec: number = Math.floor(Date.now() / 1000)): Promise<string> {
  return new SignJWT({ tv: claims.tokenVersion, sid: claims.familyId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setJti(randomUUID())
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + accessTtlSec())
    .sign(key());
}

// null bila token tidak valid/kedaluwarsa. Throw AccessSecretError HANYA bila konfigurasi server salah.
export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  const k = key();
  try {
    const { payload } = await jwtVerify(token, k, {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
      clockTolerance: 5,
    });
    if (typeof payload.sub !== "string" || typeof payload.tv !== "number" || typeof payload.sid !== "string") return null;
    return { userId: payload.sub, tokenVersion: payload.tv, familyId: payload.sid };
  } catch {
    return null;
  }
}

// Refresh token: 256-bit acak, base64url. Hanya sha256-nya yang disimpan di DB.
export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashRefreshToken(raw) };
}

export function hashRefreshToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
