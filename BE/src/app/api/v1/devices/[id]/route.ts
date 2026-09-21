import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/authz";
import { err, route } from "@/lib/http";
import { requireDeviceAccess } from "@/lib/device-access";
import { jsonWithEtag } from "@/lib/etag";
import { PACK_SELECT, toDetail } from "@/lib/device-dto";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/v1/devices/:id — snapshot lengkap (pack, cell, ringkasan, collaborator). Non-anggota -> 404.
export const GET = route<Ctx>(async (req, { params }) => {
  const { user } = await requireAuth();
  const { id } = await params;
  const { role } = await requireDeviceAccess(id, user.id, "view");

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

  return jsonWithEtag(req, toDetail(device, role, new Date()));
});
