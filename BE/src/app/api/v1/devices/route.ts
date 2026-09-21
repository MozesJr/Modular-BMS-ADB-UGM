import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/authz";
import { parseQuery, route } from "@/lib/http";
import { roleOf } from "@/lib/device-role";
import { decodeCursor, encodeCursor } from "@/lib/cursor";
import { jsonWithEtag } from "@/lib/etag";
import { PACK_SELECT, toListItem, type PackRow } from "@/lib/device-dto";
import { DevicesQuerySchema } from "@/contracts/schemas";

const cursorSchema = z.object({ c: z.iso.datetime(), i: z.string().min(1) });

// GET /api/v1/devices — device yang bisa diakses user (owner ATAU collaborator), terbaru dulu, cursor pagination.
//   ?view=summary (default) menyertakan ringkasan telemetri; ?view=basic hanya identitas + online/lastSeenAt.
export const GET = route(async (req) => {
  const { user } = await requireAuth();
  const { view, limit, cursor } = parseQuery(req, DevicesQuerySchema);

  const access: Prisma.DeviceWhereInput = {
    OR: [{ ownerId: user.id }, { collaborators: { some: { userId: user.id } } }],
  };
  let where: Prisma.DeviceWhereInput = access;
  if (cursor) {
    const { c, i } = decodeCursor(cursor, cursorSchema);
    const at = new Date(c);
    where = { AND: [access, { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: i } }] }] };
  }

  const rows = await prisma.device.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: {
      id: true,
      serialNumber: true,
      name: true,
      verified: true,
      ownerId: true,
      createdAt: true,
      owner: { select: { id: true, name: true } },
      collaborators: { where: { userId: user.id }, select: { userId: true, role: true } },
      // view=basic tidak perlu cell/telemetri: cukup waktu data untuk online/lastSeenAt.
      packs: { select: view === "summary" ? PACK_SELECT : { index: true, receivedAt: true, updatedAt: true } },
    },
  });

  const page = rows.slice(0, limit);
  const now = new Date();
  const items = page.map((d) =>
    toListItem(d, roleOf(d, user.id) ?? "viewer", now, view === "summary" ? (d.packs as PackRow[]) : undefined),
  );
  const last = page[page.length - 1];
  const nextCursor = rows.length > limit && last ? encodeCursor({ c: last.createdAt.toISOString(), i: last.id }) : null;

  // ETag dihitung tanpa mengubah semantik "online" yang bergantung waktu: klien tetap revalidasi.
  return jsonWithEtag(req, { items, nextCursor });
});
