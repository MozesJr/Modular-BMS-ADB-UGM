import type { Prisma } from "@prisma/client";
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

// Aturan "siapa boleh melihat device" untuk daftar: owner ATAU collaborator (tanpa filter verified; ADMIN tidak otomatis).
// Dipakai GET /api/devices dan GET /api/v1/devices.
export function deviceAccessWhere(userId: string): Prisma.DeviceWhereInput {
  return { OR: [{ ownerId: userId }, { collaborators: { some: { userId } } }] };
}

// Kebalikannya: semua user yang boleh melihat satu device (dipakai indeks WebSocket). Keanggotaan ditentukan oleh
// roleOf() yang sama dengan REST. Set kosong bila device tidak ada / belum punya anggota.
export async function loadDeviceViewerIds(deviceId: string): Promise<Set<string>> {
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { ownerId: true, collaborators: { select: { userId: true, role: true } } },
  });
  if (!device) return new Set();
  const candidates = [device.ownerId, ...device.collaborators.map((c) => c.userId)].filter((id): id is string => id !== null);
  return new Set(candidates.filter((userId) => roleOf(device, userId) !== null));
}
