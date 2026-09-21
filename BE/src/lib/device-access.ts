import { prisma } from "@/lib/prisma";
import { err } from "@/lib/http";
import { roleOf, type DeviceRole } from "@/lib/device-role";

// Akses device untuk API v1: bukan anggota (owner/collaborator) => 404 DEVICE_NOT_FOUND (bukan 403), agar id device
// milik orang lain tidak bisa "diraba" keberadaannya. Anggota dengan hak kurang => 403 FORBIDDEN.
export type Need = "view" | "edit" | "owner";

const RANK: Record<DeviceRole, number> = { viewer: 1, editor: 2, owner: 3 };
const NEEDED: Record<Need, number> = { view: 1, edit: 2, owner: 3 };

export async function requireDeviceAccess(deviceId: string, userId: string, need: Need) {
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: {
      id: true,
      serialNumber: true,
      name: true,
      ownerId: true,
      collaborators: { where: { userId }, select: { userId: true, role: true } },
    },
  });
  const role = device ? roleOf(device, userId) : null;
  if (!device || !role) throw err.notFound("Device tidak ditemukan", "DEVICE_NOT_FOUND");
  if (RANK[role] < NEEDED[need]) {
    const msg = need === "owner" ? "Hanya owner yang boleh melakukan ini" : "Peran Anda tidak cukup untuk melakukan ini";
    throw err.forbidden(msg);
  }
  return { device, role };
}
