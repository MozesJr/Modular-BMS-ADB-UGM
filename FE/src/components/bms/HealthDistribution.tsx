"use client";
import Link from "next/link";
import type { Device } from "@/types/device";
import type { DeviceSummary } from "@/lib/deviceSummary";
import { healthColor } from "@/lib/healthScore";

export default function HealthDistribution({ devices, summaries }: { devices: Device[]; summaries: Map<string, DeviceSummary> }) {
  const rows = devices
    .map((device) => ({ device, summary: summaries.get(device.id) }))
    .filter((r): r is { device: Device; summary: DeviceSummary } => r.summary != null)
    .sort((a, b) => a.summary.health.score - b.summary.health.score);

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-200">Health Distribution</h3>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-xs text-gray-400">Belum ada device.</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map(({ device, summary }) => {
            const hc = healthColor(summary.health.score);
            return (
              <li key={device.id}>
                <Link href={`/devices/${device.id}`} className="group flex items-center gap-3">
                  <span
                    title={device.name || device.serialNumber}
                    className="w-28 shrink-0 truncate text-xs text-gray-600 dark:text-gray-300 group-hover:text-brand-500 sm:w-40"
                  >
                    {device.name || device.serialNumber}
                  </span>
                  <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800" role="img" aria-label={`Health ${summary.health.score} dari 100`}>
                    <span
                      className="block h-full rounded-full transition-[width] duration-500"
                      style={{ width: `${Math.max(4, summary.health.score)}%`, backgroundColor: hc.ring }}
                    />
                  </span>
                  <span className={`w-8 shrink-0 text-right text-xs font-bold tabular-nums ${hc.text}`}>{summary.health.score}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
