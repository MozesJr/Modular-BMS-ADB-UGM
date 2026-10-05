import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/http";
import { log } from "@/lib/logger";
import {
  accessTtlSec,
  generateRefreshToken,
  hashRefreshToken,
  refreshFamilyMaxSec,
  refreshTtlSec,
  signAccessToken,
} from "@/lib/tokens";

// Siklus hidup sesi token mobile: login -> refresh (rotasi) -> logout. Keamanan inti:
//  - hanya hash refresh token yang disimpan
//  - setiap refresh MEMUTAR token (yang lama ditandai usedAt); memakai token lama lagi = reuse -> SELURUH family dicabut
//  - refresh membawa tokenVersion; ganti/reset password atau logout-all menaikkan tokenVersion -> refresh ditolak
//  - akun expired / user dihapus -> family dicabut

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: "USER" | "ADMIN";
  expiresAt: Date | null;
  tokenVersion: number;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  refreshExpiresIn: number;
  user: { id: string; email: string; name: string | null; role: "USER" | "ADMIN"; expiresAt: string | null };
}

const unauthorized = (code: string, message: string) => new ApiError(401, code, message);

function toResponse(user: SessionUser, accessToken: string, refreshRaw: string, refreshExpiresIn: number): IssuedTokens {
  return {
    accessToken,
    refreshToken: refreshRaw,
    tokenType: "Bearer",
    expiresIn: accessTtlSec(),
    refreshExpiresIn,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      expiresAt: user.expiresAt ? user.expiresAt.toISOString() : null,
    },
  };
}

// Login berhasil -> family baru.
export async function startSession(user: SessionUser, deviceName?: string, now: Date = new Date()): Promise<IssuedTokens> {
  const familyId = randomUUID();
  const { raw, hash } = generateRefreshToken();
  const familyExpiresAt = new Date(now.getTime() + refreshFamilyMaxSec() * 1000);
  const expiresAt = new Date(Math.min(now.getTime() + refreshTtlSec() * 1000, familyExpiresAt.getTime()));

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      familyId,
      tokenHash: hash,
      tokenVersion: user.tokenVersion,
      deviceName: deviceName || null,
      expiresAt,
      familyExpiresAt,
    },
  });
  const accessToken = await signAccessToken(
    { userId: user.id, tokenVersion: user.tokenVersion, familyId },
    Math.floor(now.getTime() / 1000),
  );
  return toResponse(user, accessToken, raw, Math.round((expiresAt.getTime() - now.getTime()) / 1000));
}

async function revokeFamily(familyId: string, now: Date) {
  await prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: now } });
}

// Tukar refresh token dengan pasangan token baru (rotasi).
export async function rotateSession(rawToken: string, now: Date = new Date()): Promise<IssuedTokens> {
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: hashRefreshToken(rawToken) } });
  if (!row) throw unauthorized("INVALID_REFRESH_TOKEN", "Refresh token tidak valid");
  if (row.revokedAt) throw unauthorized("REFRESH_REVOKED", "Sesi sudah dicabut, silakan login ulang");

  // REUSE: token yang sudah dirotasi dipakai lagi -> kemungkinan dicuri -> cabut seluruh family.
  if (row.usedAt) {
    await revokeFamily(row.familyId, now);
    log.warn("auth.refresh_reuse_detected", { userId: row.userId, familyId: row.familyId });
    throw unauthorized("REFRESH_REUSED", "Refresh token sudah pernah dipakai; sesi dicabut, silakan login ulang");
  }
  if (row.expiresAt <= now) throw unauthorized("REFRESH_EXPIRED", "Sesi berakhir, silakan login ulang");

  const user = await prisma.user.findUnique({
    where: { id: row.userId },
    select: { id: true, email: true, name: true, role: true, expiresAt: true, tokenVersion: true },
  });
  if (!user || user.tokenVersion !== row.tokenVersion) {
    await revokeFamily(row.familyId, now);
    throw unauthorized("SESSION_REVOKED", "Sesi dicabut, silakan login ulang");
  }
  if (user.expiresAt && user.expiresAt <= now) {
    await revokeFamily(row.familyId, now);
    throw new ApiError(403, "ACCOUNT_EXPIRED", "Akun sudah kedaluwarsa");
  }

  const next = generateRefreshToken();
  const expiresAt = new Date(Math.min(now.getTime() + refreshTtlSec() * 1000, row.familyExpiresAt.getTime()));

  const claimed = await prisma.$transaction(async (tx) => {
    // Compare-and-set ATOMIK: hanya satu dari dua refresh serentak yang bisa memakai token ini.
    const cas = await tx.refreshToken.updateMany({
      where: { id: row.id, usedAt: null, revokedAt: null },
      data: { usedAt: now },
    });
    if (cas.count !== 1) return false;
    const created = await tx.refreshToken.create({
      data: {
        userId: row.userId,
        familyId: row.familyId,
        tokenHash: next.hash,
        tokenVersion: user.tokenVersion,
        deviceName: row.deviceName,
        expiresAt,
        familyExpiresAt: row.familyExpiresAt,
      },
    });
    await tx.refreshToken.update({ where: { id: row.id }, data: { replacedById: created.id } });
    return true;
  });

  if (!claimed) {
    // Kalah balapan = token yang sama dipakai dua kali -> perlakukan sebagai reuse.
    await revokeFamily(row.familyId, now);
    log.warn("auth.refresh_reuse_detected", { userId: row.userId, familyId: row.familyId, concurrent: true });
    throw unauthorized("REFRESH_REUSED", "Refresh token sudah pernah dipakai; sesi dicabut, silakan login ulang");
  }

  const accessToken = await signAccessToken(
    { userId: user.id, tokenVersion: user.tokenVersion, familyId: row.familyId },
    Math.floor(now.getTime() / 1000),
  );
  return toResponse(user, accessToken, next.raw, Math.round((expiresAt.getTime() - now.getTime()) / 1000));
}

// Logout perangkat ini: cabut seluruh family dari refresh token tsb. Idempoten dan tidak membocorkan
// apakah token valid (selalu sukses). Access token yang sudah terbit tetap berlaku sampai kedaluwarsa (<= 15 menit).
export async function endSession(rawToken: string, now: Date = new Date()): Promise<void> {
  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(rawToken) },
    select: { familyId: true },
  });
  if (row) await revokeFamily(row.familyId, now);
}

// Logout dari SEMUA perangkat: tokenVersion++ mematikan semua access token seketika, semua refresh token dicabut.
export async function endAllSessions(userId: string, now: Date = new Date()): Promise<void> {
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } }),
    prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } }),
  ]);
}
