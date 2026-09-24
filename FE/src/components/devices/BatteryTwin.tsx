"use client";
import { useId, useState, type CSSProperties } from "react";
import { deriveCellStats, cellDeviationsMv, currentDirection, deviationColor, type CellReading } from "@/lib/packMetrics";
import type { Freshness } from "@/lib/freshness";
import { useReducedMotion } from "@/hooks/useReducedMotion";

const W = 340;
const H = 176;
const BODY_X = 24;
const BODY_Y = 48;
const BODY_W = 280;
const BODY_H = 104;
const WIRE_Y = 26;

type Props = {
  cells: CellReading[];
  current: number | null;
  balancerConnected: boolean;
  socPercent: number | null;
  freshness: Freshness;
};

export default function BatteryTwin({ cells, current, balancerConnected, socPercent, freshness }: Props) {
  const uid = useId().replace(/:/g, "");
  const reduced = useReducedMotion();
  const [hovered, setHovered] = useState<number | null>(null);

  const stats = deriveCellStats(cells);
  const deviations = cellDeviationsMv(cells);
  const n = deviations.length;

  const isLive = freshness === "live";
  const dir = currentDirection(current);
  const showFlow = isLive && dir !== "idle";
  const showBalance = isLive && balancerConnected && stats.minIndex != null && stats.maxIndex != null && stats.minIndex !== stats.maxIndex;

  // Rank per voltage (1 = tertinggi).
  const rankByIndex = new Map<number, number>();
  [...deviations]
    .sort((a, b) => b.voltage - a.voltage)
    .forEach((c, i) => rankByIndex.set(c.index, i + 1));

  // Geometri blok cell.
  const pad = 4;
  const cellW = n > 0 ? (BODY_W - pad * (n + 1)) / n : 0;
  const blockOf = (i: number) => ({
    x: BODY_X + pad + i * (cellW + pad),
    y: BODY_Y + pad,
    w: cellW,
    h: BODY_H - pad * 2,
    cx: BODY_X + pad + i * (cellW + pad) + cellW / 2,
  });

  const soc = socPercent ?? 0;
  const fillH = (BODY_H - pad * 2) * (soc / 100);
  const fillY = BODY_Y + pad + (BODY_H - pad * 2) - fillH;

  const maxBlock = stats.maxIndex != null ? deviations.findIndex((d) => d.index === stats.maxIndex) : -1;
  const minBlock = stats.minIndex != null ? deviations.findIndex((d) => d.index === stats.minIndex) : -1;

  const hoveredDev = hovered != null ? deviations.find((d) => d.index === hovered) : null;

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-label={`Digital twin pack: SoC ${socPercent != null ? socPercent.toFixed(0) : "—"}%, ${n} cell, delta ${stats.deltaMv ?? "—"} mV`}
        style={!isLive ? { filter: "grayscale(1)", opacity: 0.65 } : undefined}
      >
        <defs>
          <clipPath id={`body-${uid}`}>
            <rect x={BODY_X + 2} y={BODY_Y + 2} width={BODY_W - 4} height={BODY_H - 4} rx={8} />
          </clipPath>
        </defs>

        {/* Wire + sumber/beban + partikel energy-flow */}
        <line x1={BODY_X} y1={WIRE_Y} x2={BODY_X + BODY_W} y2={WIRE_Y} stroke="currentColor" className="text-gray-300 dark:text-gray-700" strokeWidth={2} />
        {showFlow &&
          !reduced &&
          [0, 1, 2, 3].map((k) => {
            const wireLen = BODY_W - 8;
            const startX = dir === "charging" ? BODY_X + 4 : BODY_X + BODY_W - 4;
            const dx = dir === "charging" ? wireLen : -wireLen;
            return (
              <circle
                key={k}
                cx={startX}
                cy={WIRE_Y}
                r={3}
                className="twin-flow"
                fill={dir === "charging" ? "#12b76a" : "#f59e0b"}
                style={{ "--twin-flow-dx": `${dx}px`, animationDelay: `${k * 0.4}s` } as CSSProperties}
              />
            );
          })}
        <text x={BODY_X} y={WIRE_Y - 6} className="fill-gray-400" fontSize={9}>
          {dir === "charging" ? "Charging" : dir === "discharging" ? "Discharging" : "Idle"}
        </text>

        {/* Body baterai + terminal */}
        <rect x={BODY_X} y={BODY_Y} width={BODY_W} height={BODY_H} rx={10} fill="none" stroke="currentColor" className="text-gray-300 dark:text-gray-600" strokeWidth={2} />
        <rect x={BODY_X + BODY_W} y={BODY_Y + BODY_H / 2 - 18} width={10} height={36} rx={3} fill="currentColor" className="text-gray-300 dark:text-gray-600" />

        {/* Blok cell berwarna deviasi */}
        {deviations.map((d, i) => {
          const b = blockOf(i);
          const isHover = hovered === d.index;
          return (
            <g
              key={d.index}
              tabIndex={0}
              role="button"
              aria-label={`Cell ${d.index}: ${d.voltage.toFixed(3)} volt, deviasi ${d.deviationMv >= 0 ? "+" : ""}${d.deviationMv} mV, rank ${rankByIndex.get(d.index)} dari ${n}`}
              onMouseEnter={() => setHovered(d.index)}
              onMouseLeave={() => setHovered((h) => (h === d.index ? null : h))}
              onFocus={() => setHovered(d.index)}
              onBlur={() => setHovered((h) => (h === d.index ? null : h))}
              style={{ cursor: "pointer", outline: "none" }}
            >
              <rect
                x={b.x}
                y={b.y}
                width={b.w}
                height={b.h}
                rx={4}
                fill={deviationColor(d.deviationMv)}
                stroke={isHover ? "#2563eb" : "transparent"}
                strokeWidth={isHover ? 2 : 0}
              />
              <title>{`Cell ${d.index}: ${d.voltage.toFixed(3)} V · ${d.deviationMv >= 0 ? "+" : ""}${d.deviationMv} mV · rank ${rankByIndex.get(d.index)}/${n}`}</title>
            </g>
          );
        })}

        {/* Liquid SoC fill (overlay translucent + garis permukaan beranimasi) */}
        {socPercent != null && n > 0 && (
          <g clipPath={`url(#body-${uid})`}>
            <rect x={BODY_X} y={fillY} width={BODY_W} height={fillH + 2} fill="#2563eb" opacity={0.16} />
            <g className={reduced ? undefined : "twin-wave"}>
              <path
                d={`M ${BODY_X - 20} ${fillY} q 10 -5 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 V ${BODY_Y + BODY_H} H ${BODY_X - 20} Z`}
                fill="#2563eb"
                opacity={0.12}
              />
            </g>
          </g>
        )}

        {/* Pulse balancer: dari cell tertinggi ke terendah */}
        {showBalance && maxBlock >= 0 && minBlock >= 0 && (
          <line
            x1={blockOf(maxBlock).cx}
            y1={BODY_Y + BODY_H / 2}
            x2={blockOf(minBlock).cx}
            y2={BODY_Y + BODY_H / 2}
            stroke="#12b76a"
            strokeWidth={2.5}
            className={reduced ? undefined : "twin-balance"}
            strokeLinecap="round"
          />
        )}

        {/* SoC angka besar */}
        <text x={BODY_X + BODY_W / 2} y={BODY_Y + BODY_H + 18} textAnchor="middle" className="fill-gray-800 dark:fill-white" fontSize={13} fontWeight={700}>
          {socPercent != null ? `SoC ~${socPercent.toFixed(0)}%` : "SoC —"}
        </text>
      </svg>

      {/* Panel info cell (hover/focus) — juga label "last known" saat tidak live */}
      <div className="mt-1 min-h-[1.25rem] text-center text-[11px] tabular-nums">
        {!isLive ? (
          <span className="font-medium text-gray-400">Menampilkan nilai terakhir diketahui (last known)</span>
        ) : hoveredDev ? (
          <span className="text-gray-600 dark:text-gray-300">
            Cell {hoveredDev.index}: <span className="font-semibold">{hoveredDev.voltage.toFixed(3)} V</span> ·{" "}
            <span className={hoveredDev.deviationMv >= 0 ? "text-red-500" : "text-blue-500"}>
              {hoveredDev.deviationMv >= 0 ? "+" : ""}
              {hoveredDev.deviationMv} mV
            </span>{" "}
            · rank {rankByIndex.get(hoveredDev.index)}/{n}
          </span>
        ) : (
          <span className="text-gray-400">Arahkan/fokus ke cell untuk detail deviasi</span>
        )}
      </div>
    </div>
  );
}
