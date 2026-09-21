"use client";
import { useAnimatedNumber } from "@/hooks/useAnimatedNumber";

export type GaugeZone = { from: number; to: number; color: string };

const SWEEP_START = 225;
const SWEEP_END = 495;
const STROKE_WIDTH = 7;
const CENTER = 50;
const RADIUS = 40;

function polarPoint(radius: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CENTER + radius * Math.sin(rad), y: CENTER - radius * Math.cos(rad) };
}

function arcPath(radius: number, fromDeg: number, toDeg: number) {
  const start = polarPoint(radius, fromDeg);
  const end = polarPoint(radius, toDeg);
  const largeArc = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

function valueToAngle(value: number, min: number, max: number) {
  const clamped = Math.min(max, Math.max(min, value));
  const t = max === min ? 0 : (clamped - min) / (max - min);
  return SWEEP_START + t * (SWEEP_END - SWEEP_START);
}

export default function Gauge({
  value,
  min,
  max,
  zones,
  label,
  unit = "",
  decimals = 0,
  size = 72,
  emptyText = "—",
  emptyTitle,
}: {
  value: number | null;
  min: number;
  max: number;
  zones: GaugeZone[];
  label: string;
  unit?: string;
  decimals?: number;
  size?: number;
  // Teks saat value null (mis. "Error" untuk sensor suhu terlepas) dan tooltip penjelasnya.
  emptyText?: string;
  emptyTitle?: string;
}) {
  const animatedValue = useAnimatedNumber(value);
  const needleValue = animatedValue ?? value;

  return (
    <div className="flex flex-col items-center">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" className="h-full w-full">
          {zones.map((zone, i) => (
            <path
              key={i}
              d={arcPath(RADIUS, valueToAngle(zone.from, min, max), valueToAngle(zone.to, min, max))}
              stroke={zone.color}
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="round"
              fill="none"
              className="opacity-90"
            />
          ))}
          {needleValue != null && (
            <g
              className="text-gray-800 dark:text-gray-200 transition-transform duration-300"
              transform={`rotate(${valueToAngle(needleValue, min, max)} ${CENTER} ${CENTER})`}
            >
              <line
                x1={CENTER}
                y1={CENTER}
                x2={CENTER}
                y2={CENTER - (RADIUS - 18)}
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
              />
              <circle cx={CENTER} cy={CENTER} r={2.5} fill="currentColor" />
            </g>
          )}
        </svg>
        <div
          className="absolute left-1/2 flex justify-center pointer-events-none"
          style={{ top: "65%", transform: "translate(-50%, -50%)" }}
        >
          <span
            className="text-[11px] font-bold text-gray-900 dark:text-white whitespace-nowrap tracking-tight"
            title={animatedValue == null ? emptyTitle : undefined}
          >
            {animatedValue != null ? `${animatedValue.toFixed(decimals)}${unit}` : emptyText}
          </span>
        </div>
      </div>
      <span className="mt-1 text-[10px] font-medium text-gray-500 dark:text-gray-400 text-center tracking-tight">
        {label}
      </span>
    </div>
  );
}