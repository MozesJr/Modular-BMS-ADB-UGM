// Ringkasan device (dipakai kartu Dashboard/My Devices, Fleet Pulse, Cell Wall, Needs Attention,
// Health Distribution, Live Event Feed) — SATU implementasi lewat getFreshness + resolveLastSeenMs
// + util derivasi/health/alarm bersama, supaya angka tidak beda-beda antar komponen.
import type { Device } from "@/types/device";
import { getFreshness, resolveLastSeenMs, hasNeverReportedData, type FreshnessResult } from "@/lib/freshness";
import { deriveCellStats, estimateSocPercent } from "@/lib/packMetrics";
import { computeHealthScore, type HealthBreakdown } from "@/lib/healthScore";
import { evaluateSnapshot, type Alarm } from "@/lib/alertRules";

export type DeviceSummary = {
  freshness: FreshnessResult & { status: ReturnType<typeof getFreshness>["status"] };
  lastSeenMs: number | null;
  // true hanya bila device belum PERNAH kirim data sama sekali (beda dari sekadar offline).
  neverReported: boolean;
  packs: Device["packs"];
  snaps: { index: number; temperature: number | null; cells: { index: number; voltage: number }[] }[];
  health: HealthBreakdown;
  alarms: Alarm[];
  // Alarm nyata (bukan pseudo-alarm "offline") — dipakai KPI/badge supaya offline tidak
  // ikut terhitung sebagai "alarm aktif".
  realAlarms: Alarm[];
  soc: number | null;
  totalPower: number;
  cellCount: number;
  worstDelta: number;
};

export function deviceSummary(device: Device, nowMs: number): DeviceSummary {
  const lastSeenMs = resolveLastSeenMs(device);
  const freshness = getFreshness(lastSeenMs, nowMs);
  const neverReported = hasNeverReportedData(device);
  const packs = [...device.packs].sort((a, b) => a.index - b.index);
  const snaps = packs.map((p) => ({
    index: p.index,
    temperature: p.temperature,
    cells: p.cells.map((c) => ({ index: c.index, voltage: c.voltage })),
  }));
  const health = computeHealthScore(snaps, freshness.status);
  const alarms = evaluateSnapshot(snaps, freshness.status);
  const realAlarms = alarms.filter((a) => a.rule !== "offline");

  // SoC device = rata-rata SoC per pack.
  const socs = packs
    .map((p) => {
      const s = deriveCellStats(p.cells);
      return estimateSocPercent(s.packVoltage, s.count);
    })
    .filter((v): v is number => v != null);
  const soc = socs.length ? socs.reduce((a, b) => a + b, 0) / socs.length : null;

  // Total daya live (jumlah power pack; null diabaikan).
  const totalPower = packs.reduce((sum, p) => sum + (p.power ?? 0), 0);
  const cellCount = packs.reduce((sum, p) => sum + p.cells.length, 0);
  // Delta terburuk antar pack.
  const worstDelta = packs.reduce((mx, p) => {
    const d = deriveCellStats(p.cells).deltaMv;
    return d != null && d > mx ? d : mx;
  }, 0);

  return { freshness, lastSeenMs, neverReported, packs, snaps, health, alarms, realAlarms, soc, totalPower, cellCount, worstDelta };
}
