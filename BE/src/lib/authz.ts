import { NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { roleOf } from "@/lib/device-role";
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
  if (!user) return null;
  if (user.expiresAt && user.expiresAt.getTime() <= Date.now()) return null;
  if ((sessionUser.tokenVersion ?? 0) !== user.tokenVersion) return null;

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

export async function requireAuth() {
  return getValidSession();
}

export async function requireAdmin() {
  const session = await getValidSession();
  if (!session || session.user.role !== "ADMIN") return null;
  return session;
}

// --- Otorisasi per device ---------------------------------------------------------------
// Satu-satunya tempat aturan "siapa boleh apa di device" didefinisikan. Route jangan
// meng-copy pengecekan owner/collaborator sendiri.

export { roleOf } from "@/lib/device-role";
export type { DeviceRole } from "@/lib/device-role";

export type DeviceAccess =
  | { ok: true; role: DeviceRole; device: { id: string; ownerId: string | null } }
  | { ok: false; response: NextResponse };

async function loadAccess(deviceId: string, userId: string) {
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: {
      id: true,
      ownerId: true,
      collaborators: { where: { userId }, select: { userId: true, role: true } },
    },
  });
  if (!device) return { notFound: true as const };
  return { notFound: false as const, device, role: roleOf(device, userId) };
}

// Owner, editor, atau viewer boleh melihat.
export async function assertCanView(deviceId: string, userId: string): Promise<DeviceAccess> {
  const access = await loadAccess(deviceId, userId);
  if (access.notFound) {
    return { ok: false, response: NextResponse.json({ error: "Device tidak ditemukan" }, { status: 404 }) };
  }
  if (!access.role) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true, role: access.role, device: { id: access.device.id, ownerId: access.device.ownerId } };
}

// Hanya owner.
export async function assertOwner(
  deviceId: string,
  userId: string,
  forbiddenMessage = "Hanya owner device yang bisa melakukan ini",
): Promise<DeviceAccess> {
  const access = await loadAccess(deviceId, userId);
  if (access.notFound) {
    return { ok: false, response: NextResponse.json({ error: "Device tidak ditemukan" }, { status: 404 }) };
  }
  if (access.role !== "owner") {
    return { ok: false, response: NextResponse.json({ error: forbiddenMessage }, { status: 403 }) };
  }
  return { ok: true, role: "owner", device: { id: access.device.id, ownerId: access.device.ownerId } };
}
