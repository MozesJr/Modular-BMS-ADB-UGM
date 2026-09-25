"use client";
import { useState, type CSSProperties } from "react";
import { useBmsSocket } from "@/hooks/useBmsSocket";
import { useWsStatus } from "@/context/WsContext";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { formatAge } from "@/lib/freshness";
import type { FleetKpi } from "@/lib/fleetKpi";
import { BoltIcon } from "@/icons";

const W = 400;
const H = 40;
const X0 = 12;
const X1 = W - 12;

function formatWh(wh: number): string {
  if (wh >= 1000) return `${(wh / 1000).toFixed(2)} kWh`;
  return `${wh.toFixed(0)} Wh`;
}

// Wire + partikel energy-flow: pakai kelas `.twin-flow`/`--twin-flow-dx` yang sama dengan
// BatteryTwin (globals.css) — bukan animasi baru — supaya bahasa visual konsisten di seluruh app.
function EnergyFlowGraphic({ dir }: { dir: "charging" | "discharging" | "idle" }) {
  const reduced = useReducedMotion();
  const showFlow = dir !== "idle";
  const wireLen = X1 - X0 - 8;
  const startX = dir === "charging" ? X0 + 4 : X1 - 4;
  const dx = dir === "charging" ? wireLen : -wireLen;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-10 w-full max-w-[420px]" role="img" aria-label={dir === "idle" ? "Tidak ada aliran daya" : dir === "charging" ? "Aliran daya masuk (charging)" : "Aliran daya keluar (discharging)"}>
      <line x1={X0} y1={H / 2} x2={X1} y2={H / 2} stroke="currentColor" className="text-gray-200 dark:text-gray-700" strokeWidth={2} />
      <circle cx={X0} cy={H / 2} r={4} className="fill-emerald-500" />
      <circle cx={X1} cy={H / 2} r={4} className="fill-amber-500" />
      <g transform={`translate(${W / 2}, ${H / 2})`} className="text-gray-400 dark:text-gray-500">
        <circle r={11} fill="currentColor" opacity={0.12} />
        <foreignObject x={-7} y={-7} width={14} height={14}>
          <BoltIcon className="h-3.5 w-3.5 text-gray-500 dark:text-gray-400" />
        </foreignObject>
      </g>
      {showFlow &&
        !reduced &&
        [0, 1, 2, 3].map((k) => (
          <circle
            key={k}
            cx={startX}
            cy={H / 2}
            r={2.5}
            className="twin-flow"
            fill={dir === "charging" ? "#12b76a" : "#f59e0b"}
            style={{ "--twin-flow-dx": `${dx}px`, animationDelay: `${k * 0.4}s` } as CSSProperties}
          />
        ))}
    </svg>
  );
}

export default function FleetPulse({
  kpi,
  nowMs,
  energyToday,
}: {
  kpi: FleetKpi;
  nowMs: number;
  energyToday?: { inWh: number; outWh: number };
}) {
  const [lastPacketAt, setLastPacketAt] = useState<number | null>(null);
  useBmsSocket(() => setLastPacketAt(Date.now()));
  const wsStatus = useWsStatus();

  const dir: "charging" | "discharging" | "idle" =
    kpi.liveCount === 0 ? "idle" : kpi.netW < -1 ? "charging" : kpi.netW > 1 ? "discharging" : "idle";

  const total = kpi.total || 1;
  const liveW = (kpi.liveCount / total) * 100;
  const staleW = (kpi.staleCount / total) * 100;
  const offlineW = (kpi.offlineCount / total) * 100;

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-6 shadow-sm">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Fleet Pulse</h2>
          <div className="mt-2 flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <div className="text-2xl font-extrabold tabular-nums text-emerald-600 dark:text-emerald-400">{kpi.chargeW.toFixed(0)} W</div>
              <div className="text-xs text-gray-400">Charge · masuk</div>
            </div>
            <div>
              <div className="text-2xl font-extrabold tabular-nums text-amber-600 dark:text-amber-400">{kpi.dischargeW.toFixed(0)} W</div>
              <div className="text-xs text-gray-400">Discharge · keluar</div>
            </div>
            <div>
              <div className={`text-2xl font-extrabold tabular-nums ${kpi.netW <= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                {kpi.netW > 0 ? "+" : ""}
                {kpi.netW.toFixed(0)} W
              </div>
              <div className="text-xs text-gray-400">Net {kpi.netW <= 0 ? "(charging)" : "(discharging)"}</div>
            </div>
          </div>
        </div>

        <EnergyFlowGraphic dir={dir} />
      </div>

      <div className="mt-6">
        <div
          className="flex h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
          role="img"
          aria-label={`${kpi.liveCount} live, ${kpi.staleCount} stale, ${kpi.offlineCount} offline dari ${kpi.total} device`}
        >
          {kpi.liveCount > 0 && <div className="bg-emerald-500" style={{ width: `${liveW}%` }} />}
          {kpi.staleCount > 0 && <div className="bg-amber-500" style={{ width: `${staleW}%` }} />}
          {kpi.offlineCount > 0 && <div className="bg-gray-300 dark:bg-gray-600" style={{ width: `${offlineW}%` }} />}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400">
          <span className="flex flex-wrap gap-3">
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {kpi.liveCount} live
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              {kpi.staleCount} stale
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
              {kpi.offlineCount} offline
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-3">
            {energyToday && (energyToday.inWh > 0 || energyToday.outWh > 0) && (
              <span className="tabular-nums" title={`Energi hari ini sejak 00:00 WIB`}>
                Hari ini: {formatWh(energyToday.inWh)} in · {formatWh(energyToday.outWh)} out
              </span>
            )}
            <span className="tabular-nums">
              {wsStatus !== "connected" ? "WS terputus" : lastPacketAt != null ? `Packet terakhir ${formatAge(nowMs - lastPacketAt)}` : "Menunggu packet…"}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
