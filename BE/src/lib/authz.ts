import type { Role } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { err } from "@/lib/http";
import { roleOf } from "@/lib/device-role";
import { checkSessionAgainstUser } from "@/lib/session-check";
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

async function getValidSession(): Promise<AuthSession | null> {
  const session = await auth();
  const sessionUser = session?.user;
  if (!sessionUser || typeof sessionUser.id !== "string") return null;

  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: { id: true, role: true, expiresAt: true, tokenVersion: true, name: true, email: true },
  });
  if (!checkSessionAgainstUser({ id: sessionUser.id, tokenVersion: sessionUser.tokenVersion }, user).ok || !user) {
    return null;
  }

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

// Melempar ApiError 401 bila tidak login/sesi tidak berlaku (ditangkap oleh route()).
export async function requireAuth(): Promise<AuthSession> {
  const session = await getValidSession();
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
