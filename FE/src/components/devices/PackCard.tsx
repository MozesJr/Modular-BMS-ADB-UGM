// FE/src/components/devices/PackCard.tsx
"use client";
import dynamic from "next/dynamic";
import type { ApexOptions } from "apexcharts";
import Badge from "@/components/ui/badge/Badge";
import { Pack, PackHistorySeries } from "@/types/device";
import { useAnimatedNumber } from "@/hooks/useAnimatedNumber";
import { getSeriesColor } from "@/lib/chartColors";

const ReactApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

// Range nominal cell Li-ion, dipakai buat estimasi SOC dari voltage karena API belum punya field capacity/SOC asli.
const NOMINAL_MIN_V = 3.0;
const NOMINAL_MAX_V = 4.2;

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
  const animatedTemp = useAnimatedNumber(pack.temperature);

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

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="rounded-lg bg-gray-50 dark:bg-white/5 px-3 py-2 text-center">
          <p className="text-[10px] text-gray-500 dark:text-gray-400">Suhu</p>
          <p className="text-sm font-medium text-gray-800 dark:text-white/90">
            {animatedTemp != null ? `${animatedTemp.toFixed(1)}°C` : "—"}
          </p>
        </div>
        <div className="rounded-lg bg-gray-50 dark:bg-white/5 px-3 py-2 text-center">
          <p className="text-[10px] text-gray-500 dark:text-gray-400">
            Imbalance
          </p>
          <p className="text-sm font-medium text-gray-800 dark:text-white/90">
            {imbalanceMv != null ? `${imbalanceMv.toFixed(0)} mV` : "—"}
          </p>
        </div>
        <div className="rounded-lg bg-gray-50 dark:bg-white/5 px-3 py-2 text-center">
          <p className="text-[10px] text-gray-500 dark:text-gray-400">
            Voltage Pack
          </p>
          <p className="text-sm font-medium text-gray-800 dark:text-white/90">
            {(animatedVoltage ?? 0).toFixed(2)}V
          </p>
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
                className={`w-[84px] rounded-lg bg-gray-50 dark:bg-white/5 px-2 py-2 text-center ${ringClass}`}
              >
                <p className="text-[10px] text-gray-500 dark:text-gray-400">
                  Cell {cell.index}
                </p>
                <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                  {cell.voltage.toFixed(3)}V
                </p>
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
