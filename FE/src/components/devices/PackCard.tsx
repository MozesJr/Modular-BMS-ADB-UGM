"use client";
import Badge from "@/components/ui/badge/Badge";
import { Pack } from "@/types/device";
import { useAnimatedNumber } from "@/hooks/useAnimatedNumber";
import { GAUGE_COLOR_ERROR, GAUGE_COLOR_SUCCESS, GAUGE_COLOR_WARNING } from "@/lib/gaugeColors";
import Gauge, { GaugeZone } from "@/components/devices/Gauge";
import {
  deriveCellStats,
  estimateSocPercent,
  currentDirection,
  isSocReliable,
} from "@/lib/packMetrics";
import type { Freshness } from "@/lib/freshness";
import BatteryTwin from "@/components/devices/BatteryTwin";
import CellBalanceChart from "@/components/devices/CellBalanceChart";

const TEMP_GAUGE_MIN = 0;
const TEMP_GAUGE_MAX = 50;
const TEMP_GAUGE_ZONES: GaugeZone[] = [
  { from: 0, to: 5, color: GAUGE_COLOR_ERROR },
  { from: 5, to: 15, color: GAUGE_COLOR_WARNING },
  { from: 15, to: 35, color: GAUGE_COLOR_SUCCESS },
  { from: 35, to: 45, color: GAUGE_COLOR_WARNING },
  { from: 45, to: 50, color: GAUGE_COLOR_ERROR },
];

const IMBALANCE_GAUGE_MIN = 0;
const IMBALANCE_GAUGE_MAX = 100;
const IMBALANCE_GAUGE_ZONES: GaugeZone[] = [
  { from: 0, to: 30, color: GAUGE_COLOR_SUCCESS },
  { from: 30, to: 60, color: GAUGE_COLOR_WARNING },
  { from: 60, to: 100, color: GAUGE_COLOR_ERROR },
];

const CURRENT_GAUGE_MAX_ABS = 5;
const CURRENT_GAUGE_ZONES: GaugeZone[] = [
  { from: 0, to: 3, color: GAUGE_COLOR_SUCCESS },
  { from: 3, to: 4.5, color: GAUGE_COLOR_WARNING },
  { from: 4.5, to: 5, color: GAUGE_COLOR_ERROR },
];
const POWER_GAUGE_MAX_VOLTAGE_PER_CELL = 3.65;

const SOC_TOOLTIP =
  "SoC estimasi dari tegangan (voltage-based) via tabel OCV LiFePO4 generik yang BELUM dikalibrasi ke sel ini. Kurva LiFePO4 sangat datar di 3.2–3.3 V, jadi angka ini indikatif — bukan coulomb counting.";

export default function PackCard({
  pack,
  freshness = "live",
}: {
  pack: Pack;
  freshness?: Freshness;
}) {
  const stats = deriveCellStats(pack.cells);
  const { count: cellCount, packVoltage, deltaMv: imbalanceMv } = stats;

  const percent = estimateSocPercent(packVoltage, cellCount);
  const socReliable = isSocReliable(pack.current);

  const animatedPercent = useAnimatedNumber(percent);
  const animatedVoltage = useAnimatedNumber(packVoltage);

  const isLive = freshness === "live";
  const direction = currentDirection(pack.current);
  const currentMagnitude = pack.current != null ? Math.abs(pack.current) : null;
  const powerMagnitude = pack.power != null ? Math.abs(pack.power) : null;

  const powerGaugeMaxAbs = cellCount > 0 ? CURRENT_GAUGE_MAX_ABS * POWER_GAUGE_MAX_VOLTAGE_PER_CELL * cellCount : 1;
  const powerGaugeZones: GaugeZone[] = [
    { from: 0, to: powerGaugeMaxAbs * 0.6, color: GAUGE_COLOR_SUCCESS },
    { from: powerGaugeMaxAbs * 0.6, to: powerGaugeMaxAbs * 0.9, color: GAUGE_COLOR_WARNING },
    { from: powerGaugeMaxAbs * 0.9, to: powerGaugeMaxAbs, color: GAUGE_COLOR_ERROR },
  ];

  const levelColor =
    percent == null
      ? { bar: "bg-gray-300 dark:bg-gray-600", badge: "light" as const }
      : percent >= 50
        ? { bar: "bg-emerald-500", badge: "success" as const }
        : percent >= 20
          ? { bar: "bg-amber-500", badge: "warning" as const }
          : { bar: "bg-red-500", badge: "error" as const };

  const statusBadge = isLive
    ? direction === "charging"
      ? { color: "success" as const, text: "Charging" }
      : direction === "discharging"
        ? { color: "warning" as const, text: "Discharging" }
        : { color: "light" as const, text: "Idle" }
    : { color: "light" as const, text: "Last known" };

  return (
    <div
      className={`rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-5 shadow-sm space-y-5 transition-opacity ${
        isLive ? "" : "opacity-70"
      }`}
    >
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-gray-100 dark:border-gray-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-gray-900 dark:text-white tabular-nums">Pack #{pack.index}</span>
            <Badge color={statusBadge.color} size="sm">{statusBadge.text}</Badge>
          </div>
          <span className="text-xs text-gray-400">{isLive ? "Live telemetry" : "Menampilkan nilai terakhir diketahui"}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-xs">
            <span className={`w-2 h-2 rounded-full ${pack.balancerConnected && isLive ? "bg-emerald-500 animate-pulse" : pack.balancerConnected ? "bg-emerald-500" : "bg-gray-400"}`} />
            <span className="font-medium text-gray-700 dark:text-gray-300">Balancer: {pack.balancerConnected ? "Active" : "Off"}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-xs">
            <span className="text-gray-400">Cells:</span>
            <span className="font-bold text-gray-800 dark:text-white tabular-nums">{cellCount}S</span>
          </div>
        </div>
      </div>

      {/* TWIN (hero) + SOC */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-center">
        <div className="rounded-xl bg-gray-50/50 dark:bg-gray-900/30 border border-gray-100 dark:border-gray-800 p-3">
          <BatteryTwin
            cells={pack.cells}
            current={pack.current}
            balancerConnected={pack.balancerConnected}
            socPercent={percent}
            freshness={freshness}
          />
        </div>

        <div className="bg-gray-50/70 dark:bg-gray-900/40 p-4 rounded-xl border border-gray-100 dark:border-gray-800 flex flex-col justify-between">
          <div>
            <div className="flex items-baseline justify-between mb-1 gap-2">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 cursor-help" title={SOC_TOOLTIP}>
                SoC · Estimasi (voltage-based)
              </span>
              {percent != null && <Badge color={levelColor.badge} size="sm">{isLive ? "Live" : "Last known"}</Badge>}
            </div>
            <div className="text-3xl font-extrabold text-gray-900 dark:text-white tabular-nums">
              {animatedPercent != null ? `${animatedPercent.toFixed(0)}%` : "—"}
            </div>
            {percent != null && !socReliable && (
              <p className="mt-1 text-[11px] font-medium text-amber-600 dark:text-amber-400 cursor-help" title="Tegangan sedang terbebani (charging/discharging) sehingga menyimpang dari OCV rest — estimasi SoC kurang akurat saat ini.">
                Tidak andal saat berbeban
              </p>
            )}
          </div>
          <div className="my-3">
            <div className="flex items-center gap-1.5">
              <div className="relative h-3.5 flex-1 rounded-md border border-gray-300 dark:border-gray-700 bg-gray-200 dark:bg-gray-700/50 p-0.5 overflow-hidden">
                <div className={`h-full rounded transition-all duration-500 ${levelColor.bar}`} style={{ width: `${animatedPercent ?? 0}%` }} />
              </div>
              <div className="h-2 w-1 rounded-r bg-gray-300 dark:bg-gray-700" />
            </div>
          </div>
          <div className="flex justify-between items-center text-xs text-gray-500 dark:text-gray-400 pt-2 border-t border-gray-200/50 dark:border-gray-800">
            <span>Total Pack Voltage</span>
            <span className="font-bold text-gray-800 dark:text-white tabular-nums">{(animatedVoltage ?? 0).toFixed(2)} V</span>
          </div>
        </div>
      </div>

      {/* GAUGES */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="rounded-xl bg-gray-50/50 dark:bg-gray-900/30 border border-gray-100 dark:border-gray-800 p-2 flex justify-center items-center">
          <Gauge value={pack.temperature} min={TEMP_GAUGE_MIN} max={TEMP_GAUGE_MAX} zones={TEMP_GAUGE_ZONES} label="Suhu" unit="°C" decimals={1} size={72} emptyText="Error" emptyTitle="Sensor suhu error / tidak ada pembacaan" />
        </div>
        <div className="rounded-xl bg-gray-50/50 dark:bg-gray-900/30 border border-gray-100 dark:border-gray-800 p-2 flex justify-center items-center">
          <Gauge value={imbalanceMv} min={IMBALANCE_GAUGE_MIN} max={IMBALANCE_GAUGE_MAX} zones={IMBALANCE_GAUGE_ZONES} label="Delta Cell" unit="mV" decimals={0} size={72} />
        </div>
        <div className="rounded-xl bg-gray-50/50 dark:bg-gray-900/30 border border-gray-100 dark:border-gray-800 p-2 flex justify-center items-center">
          <Gauge value={currentMagnitude} min={0} max={CURRENT_GAUGE_MAX_ABS} zones={CURRENT_GAUGE_ZONES} label="Arus" unit="A" decimals={2} size={72} />
        </div>
        <div className="rounded-xl bg-gray-50/50 dark:bg-gray-900/30 border border-gray-100 dark:border-gray-800 p-2 flex justify-center items-center">
          <Gauge value={powerMagnitude} min={0} max={powerGaugeMaxAbs} zones={powerGaugeZones} label="Daya" unit="W" decimals={1} size={72} />
        </div>
      </div>

      {/* CELL BALANCE (menggantikan grid 24 gauge; ada toggle grid view di dalamnya) */}
      <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
        <CellBalanceChart cells={pack.cells} />
      </div>
    </div>
  );
}
