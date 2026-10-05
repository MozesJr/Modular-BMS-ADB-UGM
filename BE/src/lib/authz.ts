import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ApiError, err } from "@/lib/http";
import { roleOf } from "@/lib/device-role";
import { principalFromAccessToken, principalFromSessionClaims, type AuthSession } from "@/lib/session-principal";
import { AccessSecretError } from "@/lib/tokens";
import { log } from "@/lib/logger";
import type { DeviceRole } from "@/lib/device-role";

// JWT session (no PrismaAdapter) tidak pernah di-invalidate otomatis. Karena itu SETIAP request
// diverifikasi ulang ke DB (satu query PK) untuk hal-hal yang tidak boleh basi:
//   - user masih ada (DB direset / user dihapus)
//   - akun belum expired (expiresAt) -> berlaku SEKETIKA, bukan hanya saat login
//   - tokenVersion sama dengan yang di token (password diganti/direset -> semua sesi lama mati)
//   - role diambil dari DB, bukan dari JWT (admin yang diturunkan langsung kehilangan akses)
export type { AuthSession };

// Principal dari access token (Authorization: Bearer). Klien mobile memakai ini; web tetap cookie Auth.js.
async function principalFromBearer(token: string): Promise<AuthSession | null> {
  try {
    return await principalFromAccessToken(token);
  } catch (e) {
    if (e instanceof AccessSecretError) {
      log.error("auth.access_secret_misconfigured", { reason: e.message });
      throw new ApiError(500, "INTERNAL", "Terjadi kesalahan pada server");
    }
    throw e;
  }
}

async function principalFromCookie(): Promise<AuthSession | null> {
  const session = await auth();
  const sessionUser = session?.user;
  if (!sessionUser || typeof sessionUser.id !== "string") return null;
  return principalFromSessionClaims(sessionUser.id, sessionUser.tokenVersion);
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
