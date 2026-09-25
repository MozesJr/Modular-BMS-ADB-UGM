"use client";
import { healthColor, healthFormula, type HealthBreakdown } from "@/lib/healthScore";

// Ring skor kesehatan 0–100 dengan rumus di tooltip (transparan).
export default function HealthRing({ breakdown, size = 56 }: { breakdown: HealthBreakdown; size?: number }) {
  const { score } = breakdown;
  const color = healthColor(score);
  const r = 20;
  const c = 2 * Math.PI * r;
  const dash = (score / 100) * c;

  return (
    <div className="inline-flex items-center gap-2.5" title={healthFormula(breakdown)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 50 50" className="h-full w-full -rotate-90">
          <circle cx="25" cy="25" r={r} fill="none" strokeWidth="5" className="text-gray-200 dark:text-gray-700" stroke="currentColor" />
          <circle
            cx="25"
            cy="25"
            r={r}
            fill="none"
            strokeWidth="5"
            stroke={color.ring}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c - dash}`}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-sm font-extrabold tabular-nums ${color.text}`}>{score}</span>
        </div>
      </div>
      <div className="leading-tight">
        <div className="text-[10px] uppercase tracking-wide text-gray-400">Health</div>
        <div className={`text-xs font-semibold ${color.text}`}>{color.label}</div>
      </div>
    </div>
  );
}
