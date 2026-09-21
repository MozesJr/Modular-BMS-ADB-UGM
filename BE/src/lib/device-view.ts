// Logika murni penurunan data tampilan dari state terbaru (Pack/Cell): tegangan pack, delta cell, online, ringkasan.
// Tanpa SoC/SoH (belum ada di payload perangkat).

export interface PackLike {
  index: number;
  temperature: number | null;
  current: number | null;
  power: number | null;
  receivedAt: Date | null;
  updatedAt: Date;
  cells: { index?: number; voltage: number }[];
}

export const round = (n: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};

export function packVoltageV(cells: { voltage: number }[]): number | null {
  if (cells.length === 0) return null;
  return round(cells.reduce((s, c) => s + c.voltage, 0), 3);
}

export function cellDeltaMv(cells: { voltage: number }[]): number | null {
  if (cells.length === 0) return null;
  const v = cells.map((c) => c.voltage);
  return round((Math.max(...v) - Math.min(...v)) * 1000, 1);
}

// Waktu server menerima data terakhir. Baris lama (sebelum kolom receivedAt ada) memakai updatedAt.
export function lastSeenAt(packs: Pick<PackLike, "receivedAt" | "updatedAt">[]): Date | null {
  if (packs.length === 0) return null;
  return new Date(Math.max(...packs.map((p) => (p.receivedAt ?? p.updatedAt).getTime())));
}

export const DEFAULT_ONLINE_THRESHOLD_SEC = 180; // 3x interval publish default (60 dtk)

export function onlineThresholdSec(env: Record<string, string | undefined> = process.env): number {
  const v = Number.parseInt(env.DEVICE_ONLINE_THRESHOLD_SEC ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_ONLINE_THRESHOLD_SEC;
}

export function isOnline(seen: Date | null, now: Date, thresholdSec: number): boolean {
  return seen !== null && now.getTime() - seen.getTime() <= thresholdSec * 1000;
}

export interface PackSummaryOut {
  index: number;
  voltageV: number | null;
  currentA: number | null;
  powerW: number | null;
  temperatureC: number | null;
  cellDeltaMv: number | null;
  cellCount: number;
}

export function packSummary(p: PackLike): PackSummaryOut {
  return {
    index: p.index,
    voltageV: packVoltageV(p.cells),
    currentA: p.current,
    powerW: p.power,
    temperatureC: p.temperature,
    cellDeltaMv: cellDeltaMv(p.cells),
    cellCount: p.cells.length,
  };
}

const nums = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null);
const maxOrNull = (xs: number[]) => (xs.length ? Math.max(...xs) : null);
const minOrNull = (xs: number[]) => (xs.length ? Math.min(...xs) : null);

export interface DeviceStatsOut {
  packs: PackSummaryOut[];
  maxTemperatureC: number | null;
  maxCellDeltaMv: number | null;
  totalPowerW: number | null;
  minCellVoltageV: number | null;
  maxCellVoltageV: number | null;
}

export function deviceStats(packs: PackLike[]): DeviceStatsOut {
  const sorted = [...packs].sort((a, b) => a.index - b.index);
  const summaries = sorted.map(packSummary);
  const allCells = sorted.flatMap((p) => p.cells.map((c) => c.voltage));
  const power = nums(summaries.map((s) => s.powerW));
  return {
    packs: summaries,
    maxTemperatureC: maxOrNull(nums(summaries.map((s) => s.temperatureC))),
    maxCellDeltaMv: maxOrNull(nums(summaries.map((s) => s.cellDeltaMv))),
    totalPowerW: power.length ? round(power.reduce((a, b) => a + b, 0), 2) : null,
    minCellVoltageV: minOrNull(allCells),
    maxCellVoltageV: maxOrNull(allCells),
  };
}
