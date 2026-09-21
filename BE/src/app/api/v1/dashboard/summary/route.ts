import type { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/authz";
import { route } from "@/lib/http";
import { jsonWithEtag } from "@/lib/etag";
import { deviceStats, isOnline, lastSeenAt, onlineThresholdSec } from "@/lib/device-view";
import type { DashboardSummarySchema } from "@/contracts/schemas";

// GET /api/v1/dashboard/summary — ringkasan lintas device (tanpa SoC/SoH). Daya, suhu, dan delta cell hanya dari
// device yang ONLINE (data usang tidak dihitung).
export const GET = route(async (req) => {
  const { user } = await requireAuth();

  const devices = await prisma.device.findMany({
    where: { OR: [{ ownerId: user.id }, { collaborators: { some: { userId: user.id } } }] },
    select: {
      verified: true,
      packs: {
        select: {
          index: true,
          temperature: true,
          current: true,
          power: true,
          receivedAt: true,
          updatedAt: true,
          cells: { select: { voltage: true } },
        },
      },
    },
  });

  const now = new Date();
  const threshold = onlineThresholdSec();
  const online = devices.filter((d) => isOnline(lastSeenAt(d.packs), now, threshold));
  const stats = online.map((d) => deviceStats(d.packs));
  const pick = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null);
  const power = pick(stats.map((s) => s.totalPowerW));
  const temp = pick(stats.map((s) => s.maxTemperatureC));
  const delta = pick(stats.map((s) => s.maxCellDeltaMv));

  const body: z.infer<typeof DashboardSummarySchema> = {
    deviceCount: devices.length,
    onlineCount: online.length,
    offlineCount: devices.length - online.length,
    pendingVerificationCount: devices.filter((d) => !d.verified).length,
    totalPowerW: power.length ? Math.round(power.reduce((a, b) => a + b, 0) * 100) / 100 : null,
    maxTemperatureC: temp.length ? Math.max(...temp) : null,
    maxCellDeltaMv: delta.length ? Math.max(...delta) : null,
    generatedAt: now.toISOString(),
  };
  // generatedAt berubah tiap request: dikeluarkan dari basis ETag supaya 304 bisa terjadi.
  const { generatedAt: _omit, ...basis } = body;
  void _omit;
  return jsonWithEtag(req, body, basis);
});
