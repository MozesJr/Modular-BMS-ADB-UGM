"use client";
import { useState, type CSSProperties } from "react";
import { useBmsSocket } from "@/hooks/useBmsSocket";
import { useWsStatus } from "@/context/WsContext";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { formatAge } from "@/lib/freshness";
import type { FleetKpi } from "@/lib/fleetKpi";

const W = 640;
const H = 170;
const CY = 92;
const SRC_X = 54;
const LOAD_X = W - 54;
const BODY_X = W / 2 - 46;
const BODY_W = 92;
const BODY_H = 76;
const BODY_Y = CY - BODY_H / 2;
const TERM_W = 8;
const WIRE_GAP = 6; // jarak wire ke node/battery

function formatWh(wh: number): string {
  if (wh >= 1000) return `${(wh / 1000).toFixed(2)} kWh`;
  return `${wh.toFixed(0)} Wh`;
}

// Kecepatan/jumlah partikel proporsional (ilustratif, bukan kalibrasi fisik presisi) terhadap
// besar daya segmen — makin besar daya, makin banyak & makin cepat partikelnya.
function flowIntensity(magnitudeW: number): { count: number; durationS: number } {
  if (magnitudeW <= 0) return { count: 0, durationS: 1.6 };
  const count = Math.max(1, Math.min(5, Math.round(magnitudeW / 40) + 1));
  const durationS = Math.max(0.7, Math.min(1.8, 1.8 - magnitudeW / 220));
  return { count, durationS };
}

// Partikel wire: pakai kelas `.twin-flow`/`--twin-flow-dx` yang SAMA dengan BatteryTwin
// (globals.css) — bukan animasi baru — durasi di-override per segmen via inline style supaya
// kecepatan mengikuti besar daya tanpa menambah keyframe baru.
function FlowParticles({ x0, x1, magnitudeW, color }: { x0: number; x1: number; magnitudeW: number; color: string }) {
  const reduced = useReducedMotion();
  const { count, durationS } = flowIntensity(magnitudeW);
  if (count === 0 || reduced) return null;
  const dx = x1 - x0;
  return (
    <>
      {Array.from({ length: count }).map((_, k) => (
        <circle
          key={k}
          cx={x0}
          cy={CY}
          r={3}
          className="twin-flow"
          fill={color}
          style={
            {
              "--twin-flow-dx": `${dx}px`,
              animationDuration: `${durationS}s`,
              animationDelay: `${(k * durationS) / count}s`,
            } as CSSProperties
          }
        />
      ))}
    </>
  );
}

// Hero: Sumber -> Baterai (SoC agregat live, fill) -> Beban. Partikel bergerak sesuai arah &
// besaran daya per segmen, diam bila tak ada device live (chargeW/dischargeW = 0 by construction
// karena fleetKpi hanya menghitung device live — lihat lib/fleetKpi.ts).
function EnergyFlowHero({ kpi }: { kpi: FleetKpi }) {
  const soc = kpi.avgSocLive;
  const hasSoc = soc != null;
  const fillH = hasSoc ? (BODY_H - 6) * (soc! / 100) : 0;
  const fillY = BODY_Y + 3 + (BODY_H - 6) - fillH;

  const srcWireX0 = SRC_X + 16 + WIRE_GAP;
  const srcWireX1 = BODY_X - WIRE_GAP;
  const loadWireX0 = BODY_X + BODY_W + TERM_W + WIRE_GAP;
  const loadWireX1 = LOAD_X - 16 - WIRE_GAP;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full max-w-[640px]"
      role="img"
      aria-label={`Aliran energi fleet: ${kpi.chargeW.toFixed(0)} watt masuk dari sumber, ${kpi.dischargeW.toFixed(0)} watt keluar ke beban, SoC rata-rata device live ${hasSoc ? soc!.toFixed(0) + "%" : "tidak tersedia"}`}
    >
      {/* Wire */}
      <line x1={srcWireX0} y1={CY} x2={srcWireX1} y2={CY} stroke="currentColor" className="text-gray-200 dark:text-gray-700" strokeWidth={2} />
      <line x1={loadWireX0} y1={CY} x2={loadWireX1} y2={CY} stroke="currentColor" className="text-gray-200 dark:text-gray-700" strokeWidth={2} />

      <FlowParticles x0={srcWireX0} x1={srcWireX1} magnitudeW={kpi.chargeW} color="#12b76a" />
      <FlowParticles x0={loadWireX0} x1={loadWireX1} magnitudeW={kpi.dischargeW} color="#f59e0b" />

      {/* Sumber */}
      <circle cx={SRC_X} cy={CY} r={16} fill="none" stroke="#12b76a" strokeWidth={2.5} />
      <circle cx={SRC_X} cy={CY} r={5} fill="#12b76a" opacity={kpi.chargeW > 0 ? 1 : 0.3} />
      <text x={SRC_X} y={CY + 34} textAnchor="middle" className="fill-gray-500 dark:fill-gray-400" fontSize={11} fontWeight={600}>
        Sumber
      </text>
      <text x={SRC_X} y={CY - 26} textAnchor="middle" className="fill-emerald-600 dark:fill-emerald-400" fontSize={11} fontWeight={700}>
        {kpi.chargeW.toFixed(0)} W
      </text>

      {/* Beban */}
      <circle cx={LOAD_X} cy={CY} r={16} fill="none" stroke="#f59e0b" strokeWidth={2.5} />
      <circle cx={LOAD_X} cy={CY} r={5} fill="#f59e0b" opacity={kpi.dischargeW > 0 ? 1 : 0.3} />
      <text x={LOAD_X} y={CY + 34} textAnchor="middle" className="fill-gray-500 dark:fill-gray-400" fontSize={11} fontWeight={600}>
        Beban
      </text>
      <text x={LOAD_X} y={CY - 26} textAnchor="middle" className="fill-amber-600 dark:fill-amber-400" fontSize={11} fontWeight={700}>
        {kpi.dischargeW.toFixed(0)} W
      </text>

      {/* Baterai (agregat) */}
      <rect x={BODY_X} y={BODY_Y} width={BODY_W} height={BODY_H} rx={10} fill="none" stroke="currentColor" className="text-gray-300 dark:text-gray-600" strokeWidth={2.5} />
      <rect x={BODY_X + BODY_W} y={CY - 14} width={TERM_W} height={28} rx={2.5} fill="currentColor" className="text-gray-300 dark:text-gray-600" />
      {hasSoc && (
        <rect x={BODY_X + 3} y={fillY} width={BODY_W - 6} height={fillH} rx={4} fill="#2563eb" opacity={0.28} />
      )}
      <text x={BODY_X + BODY_W / 2} y={CY + 4} textAnchor="middle" className="fill-gray-800 dark:fill-white" fontSize={13} fontWeight={800}>
        {hasSoc ? `${soc!.toFixed(0)}%` : "—"}
      </text>
      <text x={BODY_X + BODY_W / 2} y={CY + 34} textAnchor="middle" className="fill-gray-500 dark:fill-gray-400" fontSize={11} fontWeight={600}>
        Baterai
      </text>
      <text x={BODY_X + BODY_W / 2} y={BODY_Y - 12} textAnchor="middle" className={`font-bold ${kpi.netW <= 0 ? "fill-emerald-600 dark:fill-emerald-400" : "fill-amber-600 dark:fill-amber-400"}`} fontSize={12}>
        Net {kpi.netW > 0 ? "+" : ""}
        {kpi.netW.toFixed(0)} W
      </text>
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

  const total = kpi.total || 1;
  const liveW = (kpi.liveCount / total) * 100;
  const staleW = (kpi.staleCount / total) * 100;
  const offlineW = (kpi.offlineCount / total) * 100;

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-6 shadow-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Fleet Pulse</h2>

      <div className="mt-2 flex justify-center">
        <EnergyFlowHero kpi={kpi} />
      </div>

      <div className="mt-1 grid grid-cols-3 gap-4 text-center">
        <div>
          <div className="text-xl font-extrabold tabular-nums text-emerald-600 dark:text-emerald-400">{kpi.chargeW.toFixed(0)} W</div>
          <div className="text-xs text-gray-400">Charge · masuk</div>
        </div>
        <div>
          <div className="text-xl font-extrabold tabular-nums text-amber-600 dark:text-amber-400">{kpi.dischargeW.toFixed(0)} W</div>
          <div className="text-xs text-gray-400">Discharge · keluar</div>
        </div>
        <div>
          <div className={`text-xl font-extrabold tabular-nums ${kpi.netW <= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
            {kpi.netW > 0 ? "+" : ""}
            {kpi.netW.toFixed(0)} W
          </div>
          <div className="text-xs text-gray-400">Net {kpi.netW <= 0 ? "(charging)" : "(discharging)"}</div>
        </div>
      </div>

      <div className="mt-5">
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
              <span className="tabular-nums" title="Energi hari ini sejak 00:00 WIB">
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
