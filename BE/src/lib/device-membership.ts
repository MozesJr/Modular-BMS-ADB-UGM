import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { roleOf } from "@/lib/device-role";

// Aturan keanggotaan device TANPA impor Next (boleh dipakai custom server /ws). device-access.ts mengimpor lib/http
// (next/server) sehingga TIDAK boleh dimuat custom server: next/server di luar konteks Next menyimpan
// AsyncLocalStorage palsu dan proses crash pada request route handler pertama. Lihat src/lib/server-imports.test.ts.

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
