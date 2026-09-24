// Konfigurasi ambang alarm BMS di SATU tempat (semua evaluasi FE membaca dari sini).
// Threshold ini juga dipakai Cell Balance chart (warn ±20 mV, critical ±50 mV).
import { deriveCellStats, type CellReading } from "@/lib/packMetrics";
import type { Freshness } from "@/lib/freshness";

export const ALERT_THRESHOLDS = {
  cellOverVoltage: 3.65, // V — OV kritis bila cell > nilai ini
  cellUnderVoltage: 2.5, // V — UV kritis bila cell < nilai ini
  tempHigh: 45, // °C — suhu kritis bila > nilai ini
  imbalanceWarnMv: 20, // mV — delta cell warning
  imbalanceCriticalMv: 50, // mV — delta cell critical
} as const;

export type AlarmSeverity = "warning" | "critical";

export type AlarmRule =
  | "over_voltage"
  | "under_voltage"
  | "over_temperature"
  | "imbalance"
  | "offline";

export type Alarm = {
  id: string;
  rule: AlarmRule;
  severity: AlarmSeverity;
  message: string;
  packIndex?: number;
  cellIndex?: number;
  value?: number;
  at?: string; // ISO — hanya untuk event history
};

export const ALARM_LABELS: Record<AlarmRule, string> = {
  over_voltage: "Over-voltage",
  under_voltage: "Under-voltage",
  over_temperature: "Suhu tinggi",
  imbalance: "Imbalance cell",
  offline: "Offline",
};

type PackSnapshot = {
  index: number;
  temperature: number | null;
  cells: CellReading[];
};

// Evaluasi alarm AKTIF dari snapshot live (kartu status + badge jumlah alarm di header).
export function evaluateSnapshot(packs: PackSnapshot[], freshness: Freshness): Alarm[] {
  const alarms: Alarm[] = [];

  if (freshness === "offline") {
    alarms.push({
      id: "offline",
      rule: "offline",
      severity: "critical",
      message: "Device offline — tidak ada paket data terbaru.",
    });
    // Saat offline, nilai lain "last known" → jangan bunyikan alarm telemetri basi.
    return alarms;
  }

  for (const pack of packs) {
    const stats = deriveCellStats(pack.cells);

    for (const cell of stats.sortedCells) {
      if (cell.voltage > ALERT_THRESHOLDS.cellOverVoltage) {
        alarms.push({
          id: `ov-${pack.index}-${cell.index}`,
          rule: "over_voltage",
          severity: "critical",
          message: `Pack #${pack.index} Cell ${cell.index}: ${cell.voltage.toFixed(3)} V > ${ALERT_THRESHOLDS.cellOverVoltage} V`,
          packIndex: pack.index,
          cellIndex: cell.index,
          value: cell.voltage,
        });
      }
      if (cell.voltage < ALERT_THRESHOLDS.cellUnderVoltage) {
        alarms.push({
          id: `uv-${pack.index}-${cell.index}`,
          rule: "under_voltage",
          severity: "critical",
          message: `Pack #${pack.index} Cell ${cell.index}: ${cell.voltage.toFixed(3)} V < ${ALERT_THRESHOLDS.cellUnderVoltage} V`,
          packIndex: pack.index,
          cellIndex: cell.index,
          value: cell.voltage,
        });
      }
    }

    if (pack.temperature != null && pack.temperature > ALERT_THRESHOLDS.tempHigh) {
      alarms.push({
        id: `temp-${pack.index}`,
        rule: "over_temperature",
        severity: "critical",
        message: `Pack #${pack.index}: ${pack.temperature.toFixed(1)} °C > ${ALERT_THRESHOLDS.tempHigh} °C`,
        packIndex: pack.index,
        value: pack.temperature,
      });
    }

    if (stats.deltaMv != null && stats.deltaMv > ALERT_THRESHOLDS.imbalanceCriticalMv) {
      alarms.push({
        id: `imb-${pack.index}`,
        rule: "imbalance",
        severity: "critical",
        message: `Pack #${pack.index}: delta ${stats.deltaMv} mV > ${ALERT_THRESHOLDS.imbalanceCriticalMv} mV`,
        packIndex: pack.index,
        value: stats.deltaMv,
      });
    } else if (stats.deltaMv != null && stats.deltaMv > ALERT_THRESHOLDS.imbalanceWarnMv) {
      alarms.push({
        id: `imb-${pack.index}`,
        rule: "imbalance",
        severity: "warning",
        message: `Pack #${pack.index}: delta ${stats.deltaMv} mV > ${ALERT_THRESHOLDS.imbalanceWarnMv} mV`,
        packIndex: pack.index,
        value: stats.deltaMv,
      });
    }
  }

  return alarms;
}

// --- Timeline dari bucket history ---
export type HistoryPointForAlarm = {
  t: string;
  cellMin: number | null;
  cellMax: number | null;
  deltaMv: number | null;
  tempAvg: number | null;
};

export type AlarmEpisode = {
  rule: AlarmRule;
  severity: AlarmSeverity;
  packIndex: number;
  from: string;
  to: string;
  peak: number;
};

// Evaluasi bucket → gabung bucket berurutan yang melanggar rule sama jadi satu "episode".
export function evaluateHistoryEpisodes(
  packs: { index: number; buckets: HistoryPointForAlarm[] }[],
): AlarmEpisode[] {
  const episodes: AlarmEpisode[] = [];

  for (const pack of packs) {
    // rule -> episode aktif yang sedang dibangun
    const open = new Map<AlarmRule, AlarmEpisode>();

    const closeAll = () => {
      for (const ep of open.values()) episodes.push(ep);
      open.clear();
    };

    for (const b of pack.buckets) {
      const violations: { rule: AlarmRule; severity: AlarmSeverity; value: number }[] = [];
      if (b.cellMax != null && b.cellMax > ALERT_THRESHOLDS.cellOverVoltage)
        violations.push({ rule: "over_voltage", severity: "critical", value: b.cellMax });
      if (b.cellMin != null && b.cellMin < ALERT_THRESHOLDS.cellUnderVoltage)
        violations.push({ rule: "under_voltage", severity: "critical", value: b.cellMin });
      if (b.tempAvg != null && b.tempAvg > ALERT_THRESHOLDS.tempHigh)
        violations.push({ rule: "over_temperature", severity: "critical", value: b.tempAvg });
      if (b.deltaMv != null && b.deltaMv > ALERT_THRESHOLDS.imbalanceCriticalMv)
        violations.push({ rule: "imbalance", severity: "critical", value: b.deltaMv });

      const activeRules = new Set(violations.map((v) => v.rule));
      // Tutup episode yang tak lagi dilanggar di bucket ini.
      for (const rule of Array.from(open.keys())) {
        if (!activeRules.has(rule)) {
          episodes.push(open.get(rule)!);
          open.delete(rule);
        }
      }
      // Buka/lanjutkan episode.
      for (const v of violations) {
        const existing = open.get(v.rule);
        if (existing) {
          existing.to = b.t;
          existing.peak =
            v.rule === "under_voltage" ? Math.min(existing.peak, v.value) : Math.max(existing.peak, v.value);
        } else {
          open.set(v.rule, {
            rule: v.rule,
            severity: v.severity,
            packIndex: pack.index,
            from: b.t,
            to: b.t,
            peak: v.value,
          });
        }
      }
    }
    closeAll();
  }

  return episodes.sort((a, b) => b.from.localeCompare(a.from));
}
