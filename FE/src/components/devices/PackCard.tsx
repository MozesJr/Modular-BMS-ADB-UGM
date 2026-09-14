// FE/src/components/devices/PackCard.tsx
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

// Range nominal cell Li-ion, dipakai buat estimasi SOC dari voltage karena API belum punya field capacity/SOC asli.
const NOMINAL_MIN_V = 3.0;
const NOMINAL_MAX_V = 4.2;

// Zona gauge voltage per-cell LiFePO4: merah di luar batas aman, kuning mendekati batas, hijau normal.
const CELL_GAUGE_MIN = 2.0;
const CELL_GAUGE_MAX = 4.0;
const CELL_GAUGE_ZONES: GaugeZone[] = [
  { from: 2.0, to: 2.5, color: GAUGE_COLOR_ERROR },
  { from: 2.5, to: 2.8, color: GAUGE_COLOR_WARNING },
  { from: 2.8, to: 3.5, color: GAUGE_COLOR_SUCCESS },
  { from: 3.5, to: 3.65, color: GAUGE_COLOR_WARNING },
  { from: 3.65, to: 4.0, color: GAUGE_COLOR_ERROR },
];

// Threshold suhu ini estimasi umum untuk cell LiFePO4, sesuaikan kalau ada spesifikasi resmi dari datasheet BMS.
const TEMP_GAUGE_MIN = 0;
const TEMP_GAUGE_MAX = 50;
const TEMP_GAUGE_ZONES: GaugeZone[] = [
  { from: 0, to: 5, color: GAUGE_COLOR_ERROR },
  { from: 5, to: 15, color: GAUGE_COLOR_WARNING },
  { from: 15, to: 35, color: GAUGE_COLOR_SUCCESS },
  { from: 35, to: 45, color: GAUGE_COLOR_WARNING },
  { from: 45, to: 50, color: GAUGE_COLOR_ERROR },
];

// Imbalance: kebalikan dari gauge lain — makin kecil makin baik.
const IMBALANCE_GAUGE_MIN = 0;
const IMBALANCE_GAUGE_MAX = 100;
const IMBALANCE_GAUGE_ZONES: GaugeZone[] = [
  { from: 0, to: 30, color: GAUGE_COLOR_SUCCESS },
  { from: 30, to: 60, color: GAUGE_COLOR_WARNING },
  { from: 60, to: 100, color: GAUGE_COLOR_ERROR },
];

// Arus & daya digauge berdasarkan MAGNITUDE (nilai absolut) — arah charging/discharging
// ditampilkan terpisah lewat badge, bukan lewat gauge itu sendiri. Range sensor ACS712-05B: ±5A.
const CURRENT_GAUGE_MAX_ABS = 5; // Ampere
const CURRENT_GAUGE_ZONES: GaugeZone[] = [
  { from: 0, to: 3, color: GAUGE_COLOR_SUCCESS },
  { from: 3, to: 4.5, color: GAUGE_COLOR_WARNING },
  { from: 4.5, to: 5, color: GAUGE_COLOR_ERROR },
];
// Voltage "wajar tertinggi" per cell dipakai konsisten dengan CELL_GAUGE_ZONES (batas aman LiFePO4 3.65V).
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
    percent = clamp(
      ((packVoltage - NOMINAL_MIN_V * cellCount) / range) * 100,
      0,
      100,
    );
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

  // Zona gauge voltage total pack dihitung dinamis dari jumlah cell aktual (bukan hardcode 6 cell) —
  // setara per-cell: hijau 3.0-3.3V, kuning 2.75-3.0V & 3.3-3.45V, merah di luar itu.
  const packVoltageMin = 2.0 * cellCount;
  const packVoltageMax = 4.0 * cellCount;
  const packVoltageZones: GaugeZone[] = [
    { from: 2.0 * cellCount, to: 2.75 * cellCount, color: GAUGE_COLOR_ERROR },
    { from: 2.75 * cellCount, to: 3.0 * cellCount, color: GAUGE_COLOR_WARNING },
    { from: 3.0 * cellCount, to: 3.3 * cellCount, color: GAUGE_COLOR_SUCCESS },
    { from: 3.3 * cellCount, to: 3.45 * cellCount, color: GAUGE_COLOR_WARNING },
    { from: 3.45 * cellCount, to: 4.0 * cellCount, color: GAUGE_COLOR_ERROR },
  ];

  // current negatif = charging, positif = discharging (konvensi firmware).
  const isCharging = pack.current != null && pack.current < 0;
  const currentMagnitude = pack.current != null ? Math.abs(pack.current) : null;
  const powerMagnitude = pack.power != null ? Math.abs(pack.power) : null;

  // Max daya dihitung dinamis dari jumlah cell aktual (bukan hardcode), zona proporsional ke zona arus.
  const powerGaugeMaxAbs =
    cellCount > 0 ? CURRENT_GAUGE_MAX_ABS * POWER_GAUGE_MAX_VOLTAGE_PER_CELL * cellCount : 1;
  const powerGaugeZones: GaugeZone[] = [
    { from: 0, to: powerGaugeMaxAbs * 0.6, color: GAUGE_COLOR_SUCCESS },
    { from: powerGaugeMaxAbs * 0.6, to: powerGaugeMaxAbs * 0.9, color: GAUGE_COLOR_WARNING },
    { from: powerGaugeMaxAbs * 0.9, to: powerGaugeMaxAbs, color: GAUGE_COLOR_ERROR },
  ];

  const levelColor =
    percent == null
      ? { bar: "bg-gray-300 dark:bg-gray-600", badge: "light" as const }
      : percent >= 50
        ? { bar: "bg-success-500", badge: "success" as const }
        : percent >= 20
          ? { bar: "bg-warning-500", badge: "warning" as const }
          : { bar: "bg-error-500", badge: "error" as const };

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
      <div className="flex items-center justify-between mb-4">
        <span className="font-medium text-gray-800 dark:text-white/90">
          Pack #{pack.index}
        </span>
        <Badge color={pack.balancerConnected ? "success" : "error"}>
          Balancer {pack.balancerConnected ? "OK" : "Off"}
        </Badge>
      </div>

      {/* Battery capacity overview (estimasi dari voltage, API belum punya field SOC/capacity asli) */}
      <div className="mb-4">
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-2xl font-semibold text-gray-800 dark:text-white/90">
            {animatedPercent != null ? `${animatedPercent.toFixed(0)}%` : "—"}
          </span>
          {percent != null && <Badge color={levelColor.badge}>Estimasi SOC</Badge>}
        </div>
        <div className="flex items-center gap-1">
          <div className="relative h-6 flex-1 rounded-md border-2 border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-white/5 p-0.5">
            <div
              className={`h-full rounded-sm transition-all ${levelColor.bar}`}
              style={{ width: `${animatedPercent ?? 0}%` }}
            />
          </div>
          <div className="h-2.5 w-1 rounded-r-sm bg-gray-300 dark:bg-gray-700" />
        </div>
        <p className="mt-1.5 text-center text-[11px] text-gray-500 dark:text-gray-400">
          {(animatedVoltage ?? 0).toFixed(2)} V total
          {percent == null && " · belum ada data cell"}
        </p>
      </div>

      {/* Quick stats — gauge radial */}
      <div className="flex flex-wrap justify-center gap-3 mb-4">
        <div className="w-[250px] rounded-lg bg-gray-50 dark:bg-white/5 px-3 py-3 flex justify-center">
          <Gauge
            value={pack.temperature}
            min={TEMP_GAUGE_MIN}
            max={TEMP_GAUGE_MAX}
            zones={TEMP_GAUGE_ZONES}
            label="Suhu"
            unit="°C"
            decimals={1}
            size={84}
          />
        </div>
        <div className="w-[250px] rounded-lg bg-gray-50 dark:bg-white/5 px-3 py-3 flex justify-center">
          <Gauge
            value={imbalanceMv}
            min={IMBALANCE_GAUGE_MIN}
            max={IMBALANCE_GAUGE_MAX}
            zones={IMBALANCE_GAUGE_ZONES}
            label="Imbalance"
            unit="mV"
            decimals={0}
            size={84}
          />
        </div>
        <div className="w-[250px] rounded-lg bg-gray-50 dark:bg-white/5 px-3 py-3 flex justify-center">
          <Gauge
            value={cellCount > 0 ? packVoltage : null}
            min={packVoltageMin}
            max={cellCount > 0 ? packVoltageMax : 1}
            zones={packVoltageZones}
            label="Voltage Pack"
            unit="V"
            decimals={2}
            size={84}
          />
        </div>
        <div className="w-[250px] rounded-lg bg-gray-50 dark:bg-white/5 px-3 py-3 flex flex-col items-center gap-2">
          {pack.current != null && (
            <Badge
              color={isCharging ? "success" : "primary"}
              size="sm"
              startIcon={
                isCharging ? (
                  <ArrowUpIcon className="w-3 h-3" />
                ) : (
                  <ArrowDownIcon className="w-3 h-3" />
                )
              }
            >
              {isCharging ? "Charging" : "Discharging"}
            </Badge>
          )}
          <Gauge
            value={currentMagnitude}
            min={0}
            max={CURRENT_GAUGE_MAX_ABS}
            zones={CURRENT_GAUGE_ZONES}
            label="Arus"
            unit="A"
            decimals={2}
            size={84}
          />
        </div>
        <div className="w-[250px] rounded-lg bg-gray-50 dark:bg-white/5 px-3 py-3 flex flex-col items-center gap-2">
          {pack.power != null && (
            <Badge
              color={isCharging ? "success" : "primary"}
              size="sm"
              startIcon={
                isCharging ? (
                  <ArrowUpIcon className="w-3 h-3" />
                ) : (
                  <ArrowDownIcon className="w-3 h-3" />
                )
              }
            >
              {isCharging ? "Charging" : "Discharging"}
            </Badge>
          )}
          <Gauge
            value={powerMagnitude}
            min={0}
            max={powerGaugeMaxAbs}
            zones={powerGaugeZones}
            label="Daya"
            unit="W"
            decimals={1}
            size={84}
          />
        </div>
      </div>

      {/* Cell voltage grid — dinamis di tengah & wrap ke bawah */}
      {cellCount === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Belum ada data cell untuk pack ini.
        </p>
      ) : (
        <div className="flex flex-wrap justify-center gap-2">
          {pack.cells.map((cell, i) => {
            const isMax = hasSpread && cell.voltage === maxV;
            const isMin = hasSpread && cell.voltage === minV;
            const ringClass = isMax
              ? "ring-2 ring-warning-500"
              : isMin
                ? "ring-2 ring-blue-light-500"
                : "";
            const cellHistory = history?.cells.find((c) => c.index === cell.index);
            const sparklineData = (cellHistory?.voltage ?? []).map((point) => ({
              x: new Date(point.recordedAt).getTime(),
              y: point.voltage,
            }));

            return (
              <div
                key={cell.index}
                className={`w-[92px] rounded-lg bg-gray-50 dark:bg-white/5 px-2 py-2 text-center ${ringClass}`}
              >
                <Gauge
                  value={cell.voltage}
                  min={CELL_GAUGE_MIN}
                  max={CELL_GAUGE_MAX}
                  zones={CELL_GAUGE_ZONES}
                  label={`Cell ${cell.index}`}
                  unit="V"
                  decimals={2}
                  size={64}
                />
                {sparklineData.length > 1 && (
                  <div className="mt-1 h-8">
                    <ReactApexChart
                      options={{
                        ...sparklineOptions,
                        colors: [getSeriesColor(i)],
                      }}
                      series={[{ data: sparklineData }]}
                      type="line"
                      height={32}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
