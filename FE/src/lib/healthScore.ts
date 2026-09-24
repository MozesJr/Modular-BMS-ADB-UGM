// Health score device 0–100 (komposit balance + suhu + freshness). Rumus transparan
// (ditampilkan di tooltip), bukan angka ajaib.
import { deriveCellStats, clamp, type CellReading } from "@/lib/packMetrics";
import type { Freshness } from "@/lib/freshness";

export const HEALTH_WEIGHTS = { balance: 0.4, temperature: 0.3, freshness: 0.3 } as const;

// Batas untuk sub-skor.
const BALANCE_ZERO_MV = 100; // delta >= 100 mV → skor balance 0
const TEMP_OK_MIN = 15;
const TEMP_OK_MAX = 35;
const TEMP_CRIT_LOW = 0;
const TEMP_CRIT_HIGH = 50;

export type HealthBreakdown = {
  score: number;
  balance: number;
  temperature: number | null;
  freshness: number;
  worstPackIndex: number | null;
  deltaMv: number | null;
  temp: number | null;
};

function balanceSubscore(deltaMv: number | null): number {
  if (deltaMv == null) return 100;
  return clamp(100 * (1 - deltaMv / BALANCE_ZERO_MV), 0, 100);
}

function temperatureSubscore(temp: number | null): number | null {
  if (temp == null) return null;
  if (temp >= TEMP_OK_MIN && temp <= TEMP_OK_MAX) return 100;
  if (temp < TEMP_OK_MIN) {
    return clamp(100 * ((temp - TEMP_CRIT_LOW) / (TEMP_OK_MIN - TEMP_CRIT_LOW)), 0, 100);
  }
  return clamp(100 * ((TEMP_CRIT_HIGH - temp) / (TEMP_CRIT_HIGH - TEMP_OK_MAX)), 0, 100);
}

function freshnessSubscore(f: Freshness): number {
  return f === "live" ? 100 : f === "stale" ? 50 : 0;
}

type PackForHealth = {
  index: number;
  temperature: number | null;
  cells: CellReading[];
};

// Skor device = pack terburuk (satu pack bermasalah menurunkan kesehatan sistem).
export function computeHealthScore(packs: PackForHealth[], freshness: Freshness): HealthBreakdown {
  const fresh = freshnessSubscore(freshness);

  if (packs.length === 0) {
    return {
      score: Math.round(fresh * HEALTH_WEIGHTS.freshness),
      balance: 0,
      temperature: null,
      freshness: fresh,
      worstPackIndex: null,
      deltaMv: null,
      temp: null,
    };
  }

  let worst: HealthBreakdown | null = null;
  for (const pack of packs) {
    const stats = deriveCellStats(pack.cells);
    const bal = balanceSubscore(stats.deltaMv);
    const tempSub = temperatureSubscore(pack.temperature);
    // Bobot suhu di-redistribusi ke balance bila suhu tak tersedia.
    const score =
      tempSub == null
        ? Math.round(
            bal * (HEALTH_WEIGHTS.balance + HEALTH_WEIGHTS.temperature) + fresh * HEALTH_WEIGHTS.freshness,
          )
        : Math.round(
            bal * HEALTH_WEIGHTS.balance +
              tempSub * HEALTH_WEIGHTS.temperature +
              fresh * HEALTH_WEIGHTS.freshness,
          );

    const candidate: HealthBreakdown = {
      score: clamp(score, 0, 100),
      balance: Math.round(bal),
      temperature: tempSub == null ? null : Math.round(tempSub),
      freshness: fresh,
      worstPackIndex: pack.index,
      deltaMv: stats.deltaMv,
      temp: pack.temperature,
    };
    if (!worst || candidate.score < worst.score) worst = candidate;
  }

  return worst!;
}

export function healthColor(score: number): { text: string; ring: string; label: string } {
  if (score >= 80) return { text: "text-emerald-600 dark:text-emerald-400", ring: "#12b76a", label: "Sehat" };
  if (score >= 50) return { text: "text-amber-600 dark:text-amber-400", ring: "#f79009", label: "Perhatian" };
  return { text: "text-red-600 dark:text-red-400", ring: "#f04438", label: "Kritis" };
}

// Rumus untuk tooltip (transparan).
export function healthFormula(b: HealthBreakdown): string {
  const parts = [
    `balance ${b.balance} × 0.4`,
    b.temperature == null ? "suhu — (n/a, bobot ke balance)" : `suhu ${b.temperature} × 0.3`,
    `freshness ${b.freshness} × 0.3`,
  ];
  return `Skor ${b.score}/100 = ${parts.join(" + ")} (pack terburuk #${b.worstPackIndex ?? "—"}). ` +
    `Balance dari delta ${b.deltaMv ?? "—"} mV; suhu ${b.temp ?? "—"} °C.`;
}
