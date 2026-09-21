import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { roleOf } from "@/lib/device-role";
import type { DeviceRole } from "@/lib/device-role";

// JWT session (no PrismaAdapter) gak pernah di-invalidate otomatis kalau row User-nya
// udah gak ada — bisa terjadi pas development (DB direset/reseed sementara browser masih
// nyimpen cookie lama). Tanpa cek ini, request lolos "authenticated" tapi nanti gagal di
// query/insert Prisma dengan error FK yang membingungkan. Verifikasi user-nya BENERAN masih
// ada dulu, treat sebagai unauthenticated kalau enggak.
async function getValidSession() {
  const session = await auth();
  if (!session?.user) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true },
  });
  if (!user) return null;

  return session;
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
