import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/authz";
import { err, parseJson, parseQuery, route } from "@/lib/http";
import { requireDeviceAccess } from "@/lib/device-access";
import { loadDeviceDetail } from "@/lib/device-queries";
import { jsonWithEtag } from "@/lib/etag";
import { DeleteDeviceQuerySchema, UpdateDeviceRequestSchema } from "@/contracts/schemas";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/v1/devices/:id — snapshot lengkap (pack, cell, ringkasan, collaborator). Non-anggota -> 404.
export const GET = route<Ctx>(async (req, { params }) => {
  const { user } = await requireAuth();
  const { id } = await params;
  const { role } = await requireDeviceAccess(id, user.id, "view");
  return jsonWithEtag(req, await loadDeviceDetail(id, role));
});

// PATCH /api/v1/devices/:id — ubah nama (owner atau editor).
export const PATCH = route<Ctx>(async (req, { params }) => {
  const { user } = await requireAuth();
  const { id } = await params;
  const { role } = await requireDeviceAccess(id, user.id, "edit");
  const { name } = await parseJson(req, UpdateDeviceRequestSchema);
  await prisma.device.update({ where: { id }, data: { name } });
  return NextResponse.json(await loadDeviceDetail(id, role));
});

// DELETE /api/v1/devices/:id?mode=unclaim|delete — hanya owner.
//   unclaim (default): lepas kepemilikan. Data tetap; owner dan nama dikosongkan, verified kembali false, SEMUA collaborator dilepas.
//   delete: hapus device + seluruh riwayatnya (wajib ?confirmSerial=<serialNumber>). Perangkat yang masih mengirim data akan
//           muncul lagi sebagai device baru tanpa owner (auto-provision).
export const DELETE = route<Ctx>(async (req, { params }) => {
  const { user } = await requireAuth();
  const { id } = await params;
  const { device } = await requireDeviceAccess(id, user.id, "owner");
  const { mode, confirmSerial } = parseQuery(req, DeleteDeviceQuerySchema);

  if (mode === "delete") {
    if (confirmSerial !== device.serialNumber) {
      throw err.badRequest("Konfirmasi salah: kirim ?confirmSerial=<serialNumber device> untuk menghapus permanen", [
        { path: "confirmSerial", message: "harus sama dengan serialNumber device" },
      ]);
    }
    await prisma.device.delete({ where: { id } });
  } else {
    await prisma.$transaction([
      prisma.deviceCollaborator.deleteMany({ where: { deviceId: id } }),
      prisma.device.update({ where: { id }, data: { ownerId: null, name: null, verified: false } }),
    ]);
  }
  return new Response(null, { status: 204 });
});
