"use client";
import { useState } from "react";
import { cellDeviationsMv, deriveCellStats, type CellReading } from "@/lib/packMetrics";
import { ALERT_THRESHOLDS } from "@/lib/alertRules";
import { GAUGE_COLOR_ERROR, GAUGE_COLOR_SUCCESS, GAUGE_COLOR_WARNING } from "@/lib/gaugeColors";

const WARN = ALERT_THRESHOLDS.imbalanceWarnMv; // 20
const CRIT = ALERT_THRESHOLDS.imbalanceCriticalMv; // 50

function barColor(devMv: number): string {
  const a = Math.abs(devMv);
  if (a > CRIT) return GAUGE_COLOR_ERROR;
  if (a > WARN) return GAUGE_COLOR_WARNING;
  return GAUGE_COLOR_SUCCESS;
}

const CHART_H = 200;
const MID = 100;
const HALF = 82; // px dari tengah ke atas/bawah

export default function CellBalanceChart({ cells }: { cells: CellReading[] }) {
  const [view, setView] = useState<"bars" | "grid">("bars");
  const stats = deriveCellStats(cells);
  const deviations = cellDeviationsMv(cells);
  const n = deviations.length;

  const maxAbs = Math.max(CRIT + 10, ...deviations.map((d) => Math.abs(d.deviationMv) + 8));
  const yOf = (dev: number) => MID - (dev / maxAbs) * HALF;

  const step = 44;
  const barW = 22;
  const W = Math.max(n * step, 1);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h5 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Cell Balance — deviasi dari mean
          </h5>
          <p className="text-[11px] text-gray-400 tabular-nums">
            Delta {stats.deltaMv ?? "—"} mV · mean {stats.avg != null ? stats.avg.toFixed(3) : "—"} V
          </p>
        </div>
        <div className="flex items-center gap-0.5 rounded-lg bg-gray-100 p-1 dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
          {(["bars", "grid"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                view === v
                  ? "bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-white"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-800"
              }`}
            >
              {v === "bars" ? "Bar" : "Grid"}
            </button>
          ))}
        </div>
      </div>

      {n === 0 ? (
        <p className="text-sm text-gray-500 py-4 text-center">Belum ada data cell.</p>
      ) : view === "bars" ? (
        <div className="flex items-center gap-2">
          {/* Sumbu Y label */}
          <div className="flex flex-col justify-between text-[9px] text-gray-400 tabular-nums" style={{ height: CHART_H }}>
            <span>+{Math.round(maxAbs)}</span>
            <span>0</span>
            <span>−{Math.round(maxAbs)}</span>
          </div>
          <div className="flex-1 overflow-x-auto custom-scrollbar">
            <svg viewBox={`0 0 ${W} ${CHART_H}`} width={W} height={CHART_H} className="max-w-full" preserveAspectRatio="xMinYMid meet">
              {/* Threshold ±warn / ±crit */}
              {[WARN, -WARN].map((th) => (
                <line key={`w${th}`} x1={0} y1={yOf(th)} x2={W} y2={yOf(th)} stroke={GAUGE_COLOR_WARNING} strokeWidth={1} strokeDasharray="4 4" opacity={0.6} />
              ))}
              {[CRIT, -CRIT].map((th) => (
                <line key={`c${th}`} x1={0} y1={yOf(th)} x2={W} y2={yOf(th)} stroke={GAUGE_COLOR_ERROR} strokeWidth={1} strokeDasharray="4 4" opacity={0.6} />
              ))}
              {/* Garis mean (0) */}
              <line x1={0} y1={MID} x2={W} y2={MID} stroke="currentColor" className="text-gray-300 dark:text-gray-700" strokeWidth={1.5} />

              {deviations.map((d, i) => {
                const x = i * step + (step - barW) / 2;
                const y = d.deviationMv >= 0 ? yOf(d.deviationMv) : MID;
                const h = Math.abs(MID - yOf(d.deviationMv));
                const isMax = d.index === stats.maxIndex;
                const isMin = d.index === stats.minIndex;
                return (
                  <g key={d.index}>
                    <rect
                      x={x}
                      y={y}
                      width={barW}
                      height={Math.max(h, 1)}
                      rx={3}
                      fill={barColor(d.deviationMv)}
                      stroke={isMax ? "#f59e0b" : isMin ? "#2563eb" : "transparent"}
                      strokeWidth={isMax || isMin ? 2 : 0}
                    >
                      <title>{`Cell ${d.index}: ${d.voltage.toFixed(3)} V · ${d.deviationMv >= 0 ? "+" : ""}${d.deviationMv} mV`}</title>
                    </rect>
                    <text x={x + barW / 2} y={CHART_H - 2} textAnchor="middle" className="fill-gray-400" fontSize={9}>
                      {d.index}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      ) : (
        // Grid view ringkas: blok voltage per cell
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
          {deviations.map((d) => {
            const isMax = d.index === stats.maxIndex;
            const isMin = d.index === stats.minIndex;
            return (
              <div
                key={d.index}
                className={`rounded-lg border p-2 text-center ${
                  isMax
                    ? "ring-2 ring-amber-500 border-transparent"
                    : isMin
                      ? "ring-2 ring-blue-500 border-transparent"
                      : "border-gray-100 dark:border-gray-800"
                }`}
                title={`Cell ${d.index}: ${d.voltage.toFixed(3)} V · ${d.deviationMv >= 0 ? "+" : ""}${d.deviationMv} mV`}
              >
                <div className="text-[10px] text-gray-400">Cell {d.index}</div>
                <div className="text-sm font-bold text-gray-800 dark:text-white tabular-nums">{d.voltage.toFixed(3)}</div>
                <div
                  className="text-[10px] font-semibold tabular-nums"
                  style={{ color: barColor(d.deviationMv) }}
                >
                  {d.deviationMv >= 0 ? "+" : ""}
                  {d.deviationMv} mV
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
