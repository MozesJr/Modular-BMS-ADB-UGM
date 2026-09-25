"use client";
import { useState } from "react";
import Link from "next/link";
import Badge from "@/components/ui/badge/Badge";
import type { Device, DeviceSparkPoint } from "@/types/device";
import { getFreshness, formatAge, FRESHNESS_META } from "@/lib/freshness";
import { deriveCellStats, estimateSocPercent, cellDeviationsMv, deviationColor } from "@/lib/packMetrics";
import { computeHealthScore } from "@/lib/healthScore";
import { evaluateSnapshot } from "@/lib/alertRules";
import { healthColor } from "@/lib/healthScore";
import { CopyIcon, CheckLineIcon } from "@/icons";

// Ringkasan device untuk kartu (dipakai getFreshness + util derivasi/health/alarm bersama).
export function deviceSummary(device: Device, nowMs: number) {
  const freshness = getFreshness(device.lastSeen ? new Date(device.lastSeen).getTime() : null, nowMs);
  const packs = [...device.packs].sort((a, b) => a.index - b.index);
  const snaps = packs.map((p) => ({
    index: p.index,
    temperature: p.temperature,
    cells: p.cells.map((c) => ({ index: c.index, voltage: c.voltage })),
  }));
  const health = computeHealthScore(snaps, freshness.status);
  const alarms = evaluateSnapshot(snaps, freshness.status);

  // SoC device = rata-rata SoC per pack.
  const socs = packs
    .map((p) => {
      const s = deriveCellStats(p.cells);
      return estimateSocPercent(s.packVoltage, s.count);
    })
    .filter((v): v is number => v != null);
  const soc = socs.length ? socs.reduce((a, b) => a + b, 0) / socs.length : null;

  // Total daya live (jumlah power pack; null diabaikan).
  const totalPower = packs.reduce((sum, p) => sum + (p.power ?? 0), 0);
  const cellCount = packs.reduce((sum, p) => sum + p.cells.length, 0);
  // Delta terburuk antar pack.
  const worstDelta = packs.reduce((mx, p) => {
    const d = deriveCellStats(p.cells).deltaMv;
    return d != null && d > mx ? d : mx;
  }, 0);

  return { freshness, packs, snaps, health, alarms, soc, totalPower, cellCount, worstDelta };
}

// Sparkline SVG kecil (tanpa lib). Memutus garis saat gap bucket (jarak waktu > 2× spacing minimum).
function Sparkline({ spark }: { spark: DeviceSparkPoint[] }) {
  const usePower = spark.some((p) => p.powerW != null);
  const pts = spark
    .map((p) => ({ t: new Date(p.t).getTime(), v: usePower ? p.powerW : p.deltaMv }))
    .filter((p) => Number.isFinite(p.t));
  const valid = pts.filter((p): p is { t: number; v: number } => p.v != null);
  if (valid.length < 2) return null;

  const W = 100;
  const H = 28;
  const xs = valid.map((p) => p.t);
  const vs = valid.map((p) => p.v);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minV = Math.min(...vs);
  const maxV = Math.max(...vs);
  const spanX = maxX - minX || 1;
  const spanV = maxV - minV || 1;
  // Gap threshold = 2× spacing minimum antar titik valid.
  let minGap = Infinity;
  for (let i = 1; i < valid.length; i++) minGap = Math.min(minGap, valid[i].t - valid[i - 1].t);
  const gapMs = (Number.isFinite(minGap) ? minGap : spanX) * 2.5;

  const x = (t: number) => ((t - minX) / spanX) * W;
  const y = (v: number) => H - 2 - ((v - minV) / spanV) * (H - 4);

  const segments: string[] = [];
  let cur: string[] = [];
  for (let i = 0; i < valid.length; i++) {
    if (i > 0 && valid[i].t - valid[i - 1].t > gapMs) {
      if (cur.length) segments.push(cur.join(" "));
      cur = [];
    }
    cur.push(`${x(valid[i].t).toFixed(1)},${y(valid[i].v).toFixed(1)}`);
  }
  if (cur.length) segments.push(cur.join(" "));

  return (
    <div title={usePower ? "Daya 6 jam (W)" : "Delta cell 6 jam (mV)"}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-7" preserveAspectRatio="none" aria-hidden>
        {segments.map((pts2, i) => (
          <polyline key={i} points={pts2} fill="none" stroke="#465fff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
    </div>
  );
}

function CellStrip({ cells }: { cells: { index: number; voltage: number }[] }) {
  const devs = cellDeviationsMv(cells);
  if (devs.length === 0) return null;
  return (
    <div className="flex gap-0.5 h-6 w-full" aria-hidden>
      {devs.map((d) => (
        <div
          key={d.index}
          className="flex-1 rounded-sm min-w-[3px]"
          style={{ backgroundColor: deviationColor(d.deviationMv) }}
          title={`Cell ${d.index}: ${d.voltage.toFixed(3)} V · ${d.deviationMv >= 0 ? "+" : ""}${d.deviationMv} mV`}
        />
      ))}
    </div>
  );
}

export default function DeviceCard({
  device,
  variant = "compact",
  nowMs = Date.now(),
  spark,
}: {
  device: Device;
  variant?: "compact" | "detailed";
  nowMs?: number;
  spark?: DeviceSparkPoint[];
}) {
  const [copied, setCopied] = useState(false);
  const { freshness, packs, health, alarms, soc, cellCount, worstDelta } = deviceSummary(device, nowMs);
  const meta = FRESHNESS_META[freshness.status];
  const hc = healthColor(health.score);
  const dim = freshness.status === "offline";

  async function copyId(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(device.serialNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  return (
    <Link
      href={`/devices/${device.id}`}
      className={`block rounded-2xl border border-gray-200 dark:border-gray-800 p-5 bg-white dark:bg-white/[0.03] transition-all duration-200 hover:border-brand-500 hover:shadow-md ${
        dim ? "opacity-75" : ""
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-bold text-gray-900 dark:text-white/90 truncate text-base">{device.name || device.serialNumber}</h4>
            {device.verified ? <Badge color="success" size="sm">Verified</Badge> : <Badge color="warning" size="sm">Pending</Badge>}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="text-xs text-gray-500 font-mono truncate">{device.serialNumber}</span>
            {variant === "detailed" && (
              <button type="button" onClick={copyId} title="Salin ID" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                {copied ? <CheckLineIcon className="w-3.5 h-3.5 text-emerald-500" /> : <CopyIcon className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
        </div>
        {/* Health mini ring */}
        <div className="shrink-0 text-right" title={`Health ${health.score}/100`}>
          <div className={`text-lg font-extrabold tabular-nums ${hc.text}`}>{health.score}</div>
          <div className="text-[10px] uppercase tracking-wide text-gray-400">health</div>
        </div>
      </div>

      {/* Cell-strip per pack */}
      <div className="space-y-1.5 mb-3">
        {packs.slice(0, variant === "detailed" ? packs.length : 1).map((p) => (
          <CellStrip key={p.index} cells={p.cells.map((c) => ({ index: c.index, voltage: c.voltage }))} />
        ))}
        {variant === "compact" && packs.length > 1 && (
          <span className="text-[10px] text-gray-400">+{packs.length - 1} pack lain</span>
        )}
      </div>

      {/* Sparkline 6 jam (delta/power) — hanya bila data summary tersedia */}
      {spark && spark.length > 1 && (
        <div className="mb-3">
          <Sparkline spark={spark} />
        </div>
      )}

      {/* Metrics row */}
      <div className="grid grid-cols-3 gap-2 mb-3 text-center">
        <div>
          <div className="text-sm font-bold text-gray-800 dark:text-white tabular-nums">{soc != null ? `${soc.toFixed(0)}%` : "—"}</div>
          <div className="text-[10px] text-gray-400">SoC est.</div>
        </div>
        <div>
          <div className={`text-sm font-bold tabular-nums ${worstDelta > 50 ? "text-red-500" : worstDelta > 20 ? "text-amber-500" : "text-gray-800 dark:text-white"}`}>{worstDelta} mV</div>
          <div className="text-[10px] text-gray-400">Δ max</div>
        </div>
        <div>
          <div className="text-sm font-bold text-gray-800 dark:text-white tabular-nums">{packs.length}×{cellCount}</div>
          <div className="text-[10px] text-gray-400">pack×cell</div>
        </div>
      </div>

      {/* Footer: freshness + alarms (+ collaborators for detailed) */}
      <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-gray-800">
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${meta.text}`}>
          <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
          {meta.label} · {device.lastSeen ? formatAge(freshness.ageMs) : "belum ada data"}
        </span>
        <div className="flex items-center gap-2">
          {variant === "detailed" && (
            <span className="text-xs text-gray-400">{device.collaborators.length} kolab</span>
          )}
          {alarms.length > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-400">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
              {alarms.length}
            </span>
          ) : (
            <span className="text-xs text-emerald-600 dark:text-emerald-400">OK</span>
          )}
        </div>
      </div>
    </Link>
  );
}
