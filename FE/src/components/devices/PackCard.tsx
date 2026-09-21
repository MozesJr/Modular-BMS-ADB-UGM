"use client";
import dynamic from "next/dynamic";
import type { ApexOptions } from "apexcharts";
import Badge from "@/components/ui/badge/Badge";
import { Pack, PackHistorySeries } from "@/types/device";
import { useAnimatedNumber } from "@/hooks/useAnimatedNumber";
import { getSeriesColor } from "@/lib/chartColors";
import { GAUGE_COLOR_ERROR, GAUGE_COLOR_SUCCESS, GAUGE_COLOR_WARNING } from "@/lib/gaugeColors";
import Gauge, { GaugeZone } from "@/components/devices/Gauge";
import { ArrowUpIcon, ArrowDownIcon } from "@/icons";

const ReactApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

const NOMINAL_MIN_V = 3.0;
const NOMINAL_MAX_V = 4.2;

const CELL_GAUGE_MIN = 2.0;
const CELL_GAUGE_MAX = 4.0;
const CELL_GAUGE_ZONES: GaugeZone[] = [
  { from: 2.0, to: 2.5, color: GAUGE_COLOR_ERROR },
  { from: 2.5, to: 2.8, color: GAUGE_COLOR_WARNING },
  { from: 2.8, to: 3.5, color: GAUGE_COLOR_SUCCESS },
  { from: 3.5, to: 3.65, color: GAUGE_COLOR_WARNING },
  { from: 3.65, to: 4.0, color: GAUGE_COLOR_ERROR },
];

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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const sparklineOptions: ApexOptions = {
  chart: { sparkline: { enabled: true }, animations: { enabled: false } },
  stroke: { curve: "smooth", width: 1.5 },
  tooltip: { enabled: false },
  markers: { size: 0 },
};

export default function PackCard({
  pack,
  history,
}: {
  pack: Pack;
  history?: PackHistorySeries | null;
}) {
  const cellCount = pack.cells.length;
  const packVoltage = pack.cells.reduce((sum, cell) => sum + cell.voltage, 0);

  let percent: number | null = null;
  if (cellCount > 0) {
    const range = (NOMINAL_MAX_V - NOMINAL_MIN_V) * cellCount;
    percent = clamp(((packVoltage - NOMINAL_MIN_V * cellCount) / range) * 100, 0, 100);
  }

  let maxV: number | null = null;
  let minV: number | null = null;
  let imbalanceMv: number | null = null;
  if (cellCount > 0) {
    const voltages = pack.cells.map((c) => c.voltage);
    maxV = Math.max(...voltages);
    minV = Math.min(...voltages);
    imbalanceMv = (maxV - minV) * 1000;
  }
  const hasSpread = maxV != null && minV != null && maxV !== minV;

  const animatedPercent = useAnimatedNumber(percent);
  const animatedVoltage = useAnimatedNumber(packVoltage);

  const packVoltageMin = 2.0 * cellCount;
  const packVoltageMax = 4.0 * cellCount;
  const packVoltageZones: GaugeZone[] = [
    { from: 2.0 * cellCount, to: 2.75 * cellCount, color: GAUGE_COLOR_ERROR },
    { from: 2.75 * cellCount, to: 3.0 * cellCount, color: GAUGE_COLOR_WARNING },
    { from: 3.0 * cellCount, to: 3.3 * cellCount, color: GAUGE_COLOR_SUCCESS },
    { from: 3.3 * cellCount, to: 3.45 * cellCount, color: GAUGE_COLOR_WARNING },
    { from: 3.45 * cellCount, to: 4.0 * cellCount, color: GAUGE_COLOR_ERROR },
  ];

  const isCharging = pack.current != null && pack.current < 0;
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

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-5 shadow-sm space-y-5">
      
      {/* 1. HEADER KARTU PACK & STATUS SWITCH MINI ALA HOME ASSISTANT */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-gray-100 dark:border-gray-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-gray-900 dark:text-white">
              Pack #{pack.index}
            </span>
            <Badge color={isCharging ? "success" : "info"} size="sm">
              {isCharging ? "⚡ CHARGING" : "🔋 STANDBY / DISCHG"}
            </Badge>
          </div>
          <span className="text-xs text-gray-400">Live Telemetry Control Unit</span>
        </div>

        {/* Status Pills Mini ala Home Assistant */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-xs">
            <span className={`w-2 h-2 rounded-full ${pack.balancerConnected ? "bg-emerald-500 animate-pulse" : "bg-red-500"}`} />
            <span className="font-medium text-gray-700 dark:text-gray-300">
              Balancer: {pack.balancerConnected ? "Active" : "Off"}
            </span>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-xs">
            <span className="text-gray-400">Cells:</span>
            <span className="font-bold text-gray-800 dark:text-white">{cellCount}S</span>
          </div>
        </div>
      </div>

      {/* 2. BARIS UTAMA: SOC PROGRESS & KEY METRICS GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Kolom Kiri: Estimasi SOC Bar */}
        <div className="lg:col-span-1 bg-gray-50/70 dark:bg-gray-900/40 p-4 rounded-xl border border-gray-100 dark:border-gray-800 flex flex-col justify-between">
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">ESTIMATED SOC</span>
              {percent != null && <Badge color={levelColor.badge} size="sm">Live</Badge>}
            </div>
            <div className="text-3xl font-extrabold text-gray-900 dark:text-white">
              {animatedPercent != null ? `${animatedPercent.toFixed(0)}%` : "—"}
            </div>
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
            <span className="font-bold text-gray-800 dark:text-white">{(animatedVoltage ?? 0).toFixed(2)} V</span>
          </div>
        </div>

        {/* Kolom Kanan: Radial Gauges Grid (Suhu, Delta, Arus, Daya, Pack Volts) */}
        <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
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
      </div>

      {/* 3. GRID SEL BATERAI INDIVIDU DENGAN SPARKLINE MINI */}
      <div className="pt-2">
        <div className="flex items-center justify-between mb-3">
          <h5 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Individual Cell Voltages ({cellCount} Cells Breakdown)
          </h5>
          {hasSpread && (
            <div className="flex items-center gap-3 text-[11px] text-gray-500">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> Max Cell</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" /> Min Cell</span>
            </div>
          )}
        </div>

        {cellCount === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">Belum ada data cell telemetri untuk pack ini.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2.5">
            {pack.cells.map((cell, i) => {
              const isMax = hasSpread && cell.voltage === maxV;
              const isMin = hasSpread && cell.voltage === minV;
              const ringClass = isMax
                ? "ring-2 ring-amber-500 bg-amber-50/30 dark:bg-amber-500/10"
                : isMin
                  ? "ring-2 ring-blue-500 bg-blue-50/30 dark:bg-blue-500/10"
                  : "bg-gray-50/80 dark:bg-gray-900/40 border-gray-100 dark:border-gray-800";
              
              const cellHistory = history?.cells.find((c) => c.index === cell.index);
              const sparklineData = (cellHistory?.voltage ?? []).map((point) => ({
                x: new Date(point.recordedAt).getTime(),
                y: point.voltage,
              }));

              return (
                <div
                  key={cell.index}
                  className={`rounded-xl border p-2.5 text-center transition-all ${ringClass}`}
                >
                  <Gauge
                    value={cell.voltage}
                    min={CELL_GAUGE_MIN}
                    max={CELL_GAUGE_MAX}
                    zones={CELL_GAUGE_ZONES}
                    label={`Cell ${cell.index}`}
                    unit="V"
                    decimals={2}
                    size={60}
                  />
                  {sparklineData.length > 1 && (
                    <div className="mt-1.5 h-6">
                      <ReactApexChart
                        options={{
                          ...sparklineOptions,
                          colors: [getSeriesColor(i)],
                        }}
                        series={[{ data: sparklineData }]}
                        type="line"
                        height={24}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}