import { requireAuth } from "@/lib/authz";
import { parseQuery, route } from "@/lib/http";
import { requireDeviceAccess } from "@/lib/device-access";
import { jsonWithEtag } from "@/lib/etag";
import { assertPointBudget, resolveHistoryParams } from "@/lib/history";
import { loadHistory, seriesCounts } from "@/lib/history-store";
import { HistoryQuerySchema } from "@/contracts/schemas";
import type { z } from "zod";
import type { HistoryResponseSchema } from "@/contracts/schemas";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/v1/devices/:id/history — time-series per pack (temperature/current/power) atau per cell (voltage).
//   bucket=raw   : sampel asli, keyset pagination (cursor), rentang maks 48 jam, tidak boleh mencampur voltage dengan metrik pack
//   bucket=1m|5m|1h : agregat di SQL (avg/min/max), dibatasi ~20.000 titik total (400 bila lebih)
// Data > 30 hari hanya tersedia sebagai agregat (rollup 1 menit).
export const GET = route<Ctx>(async (req, { params }) => {
  const { user } = await requireAuth();
  const { id } = await params;
  await requireDeviceAccess(id, user.id, "view");

  const query = parseQuery(req, HistoryQuerySchema);
  const now = new Date();
  const p = resolveHistoryParams(query, now);

  const { packCount, cellCount } = await seriesCounts(id, p.packIndex);
  assertPointBudget(p, packCount, cellCount);

  const { series, nextCursor } = await loadHistory(id, p, now);
  const body: z.infer<typeof HistoryResponseSchema> = {
    deviceId: id,
    from: p.from.toISOString(),
    to: p.to.toISOString(),
    bucket: p.bucket,
    series,
    nextCursor,
  };
  // Default `to` = sekarang berubah tiap request; ETag dihitung dari ISI data (seri), bukan dari from/to yang diulang,
  // sehingga 304 tetap terjadi selama data yang dikembalikan sama.
  return jsonWithEtag(req, body, { deviceId: id, bucket: p.bucket, series, nextCursor });
});
