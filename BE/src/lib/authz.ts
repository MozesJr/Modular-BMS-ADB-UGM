import { headers } from "next/headers";
import type { Role } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ApiError, err } from "@/lib/http";
import { roleOf } from "@/lib/device-role";
import { checkSessionAgainstUser } from "@/lib/session-check";
import { AccessSecretError, verifyAccessToken } from "@/lib/tokens";
import { log } from "@/lib/logger";
import type { DeviceRole } from "@/lib/device-role";

// JWT session (no PrismaAdapter) tidak pernah di-invalidate otomatis. Karena itu SETIAP request
// diverifikasi ulang ke DB (satu query PK) untuk hal-hal yang tidak boleh basi:
//   - user masih ada (DB direset / user dihapus)
//   - akun belum expired (expiresAt) -> berlaku SEKETIKA, bukan hanya saat login
//   - tokenVersion sama dengan yang di token (password diganti/direset -> semua sesi lama mati)
//   - role diambil dari DB, bukan dari JWT (admin yang diturunkan langsung kehilangan akses)
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

const USER_SELECT = { id: true, role: true, expiresAt: true, tokenVersion: true, name: true, email: true } as const;

function toAuthSession(user: {
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

// Principal dari access token (Authorization: Bearer). Klien mobile memakai ini; web tetap cookie Auth.js.
async function principalFromBearer(token: string): Promise<AuthSession | null> {
  let claims;
  try {
    claims = await verifyAccessToken(token);
  } catch (e) {
    if (e instanceof AccessSecretError) {
      log.error("auth.access_secret_misconfigured", { reason: e.message });
      throw new ApiError(500, "INTERNAL", "Terjadi kesalahan pada server");
    }
    throw e;
  }
  if (!claims) return null;
  const user = await prisma.user.findUnique({ where: { id: claims.userId }, select: USER_SELECT });
  if (!checkSessionAgainstUser({ id: claims.userId, tokenVersion: claims.tokenVersion }, user).ok || !user) return null;
  return toAuthSession(user);
}

async function principalFromCookie(): Promise<AuthSession | null> {
  const session = await auth();
  const sessionUser = session?.user;
  if (!sessionUser || typeof sessionUser.id !== "string") return null;

  const user = await prisma.user.findUnique({ where: { id: sessionUser.id }, select: USER_SELECT });
  if (!checkSessionAgainstUser({ id: sessionUser.id, tokenVersion: sessionUser.tokenVersion }, user).ok || !user) {
    return null;
  }
  return toAuthSession(user);
}

// getPrincipal: Bearer access token ATAU cookie Auth.js. Bila header Authorization ADA tetapi tidak valid -> tidak
// jatuh ke cookie (gagal tegas). Semua cek (user ada, belum expired, tokenVersion, role) selalu ke DB.
export async function getPrincipal(): Promise<AuthSession | null> {
  const authorization = (await headers()).get("authorization");
  if (authorization) {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
    if (!match) return null;
    return principalFromBearer(match[1]);
  }
  return principalFromCookie();
}

// Melempar ApiError 401 bila tidak login/sesi tidak berlaku (ditangkap oleh route()).
export async function requireAuth(): Promise<AuthSession> {
  const session = await getPrincipal();
  if (!session) throw err.unauthorized();
  return session;
}

// 401 bila belum login, 403 bila login tapi bukan ADMIN.
export async function requireAdmin(): Promise<AuthSession> {
  const session = await requireAuth();
  if (session.user.role !== "ADMIN") throw err.forbidden("Hanya admin yang boleh mengakses ini");
  return session;
}

// --- Otorisasi per device ---------------------------------------------------------------
// Satu-satunya tempat aturan "siapa boleh apa di device" didefinisikan. Route jangan
// meng-copy pengecekan owner/collaborator sendiri.

export { roleOf } from "@/lib/device-role";
export type { DeviceRole } from "@/lib/device-role";

export type DeviceAccess = {
  role: DeviceRole;
  device: { id: string; ownerId: string | null };
};

async function loadAccess(deviceId: string, userId: string) {
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: {
      id: true,
      ownerId: true,
      collaborators: { where: { userId }, select: { userId: true, role: true } },
    },
  });
  if (!device) throw err.notFound("Device tidak ditemukan", "DEVICE_NOT_FOUND");
  return { device, role: roleOf(device, userId) };
}

// Owner, editor, atau viewer boleh melihat. Melempar 404 (device tidak ada) / 403 (bukan anggota).
export async function assertCanView(deviceId: string, userId: string): Promise<DeviceAccess> {
  const { device, role } = await loadAccess(deviceId, userId);
  if (!role) throw err.forbidden();
  return { role, device: { id: device.id, ownerId: device.ownerId } };
}

// Hanya owner. Melempar 404 / 403.
export async function assertOwner(
  deviceId: string,
  userId: string,
  forbiddenMessage = "Hanya owner device yang bisa melakukan ini",
): Promise<DeviceAccess> {
  const { device, role } = await loadAccess(deviceId, userId);
  if (role !== "owner") throw err.forbidden(forbiddenMessage);
  return { role, device: { id: device.id, ownerId: device.ownerId } };
}
