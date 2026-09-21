import { prisma } from "@/lib/prisma";
import { err } from "@/lib/http";
import type { DeviceRole } from "@/lib/device-role";
import { PACK_SELECT, toDetail, type DeviceDetailDto } from "@/lib/device-dto";

// Memuat DeviceDetail lengkap (dipakai GET, PATCH, dan klaim di API v1).
export async function loadDeviceDetail(id: string, role: DeviceRole, now: Date = new Date()): Promise<DeviceDetailDto> {
  const device = await prisma.device.findUnique({
    where: { id },
    select: {
      id: true,
      serialNumber: true,
      name: true,
      verified: true,
      createdAt: true,
      owner: { select: { id: true, name: true } },
      packs: { select: PACK_SELECT },
      collaborators: {
        orderBy: { addedAt: "asc" },
        select: { userId: true, role: true, addedAt: true, user: { select: { name: true, email: true } } },
      },
    },
  });
  if (!device) throw err.notFound("Device tidak ditemukan", "DEVICE_NOT_FOUND");
  return toDetail(device, role, now);
}
