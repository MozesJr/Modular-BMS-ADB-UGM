"use client";
import { memo, useState } from "react";
import Link from "next/link";
import type { Device } from "@/types/device";
import { deviceSummary } from "@/lib/deviceSummary";
import { cellDeviationsMv, deviationColor } from "@/lib/packMetrics";
import { formatAge, FRESHNESS_META } from "@/lib/freshness";
import { ChevronDownIcon, ChevronUpIcon } from "@/icons";

const COLLAPSE_AFTER_MS = 24 * 60 * 60 * 1000;

// Overlay garis-garis halus (hatch) untuk pack yang tidak live — dibedakan dari live tanpa
// mengandalkan warna saja (kontras 4.5:1 tetap dijaga di teks/label, bukan di overlay ini).
const HATCH_STYLE = {
  backgroundImage:
    "repeating-linear-gradient(45deg, rgba(107,114,128,0.16) 0, rgba(107,114,128,0.16) 1px, transparent 1px, transparent 7px)",
} as const;

function PackGrid({
  deviceId,
  deviceLabel,
  packIndex,
  cells,
  isLive,
}: {
  deviceId: string;
  deviceLabel: string;
  packIndex: number;
  cells: { index: number; voltage: number }[];
  isLive: boolean;
}) {
  const devs = cellDeviationsMv(cells);
  if (devs.length === 0) return null;
  return (
    <div className="relative">
      <div
        className="grid gap-[2px]"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(14px, 1fr))" }}
      >
        {devs.map((d) => (
          <Link
            key={d.index}
            href={`/devices/${deviceId}`}
            title={`${deviceLabel} · Pack #${packIndex} · Cell ${d.index}: ${d.voltage.toFixed(3)} V · ${d.deviationMv >= 0 ? "+" : ""}${d.deviationMv} mV`}
            aria-label={`${deviceLabel}, pack ${packIndex}, cell ${d.index}, ${d.voltage.toFixed(3)} volt, deviasi ${d.deviationMv >= 0 ? "+" : ""}${d.deviationMv} milivolt`}
            className="block h-3.5 rounded-[2px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-gray-900"
            style={{ backgroundColor: deviationColor(d.deviationMv) }}
          />
        ))}
      </div>
      {!isLive && <div className="pointer-events-none absolute inset-0 rounded-[2px]" style={HATCH_STYLE} aria-hidden />}
    </div>
  );
}

function DeviceGroupImpl({ device, nowMs }: { device: Device; nowMs: number }) {
  const { freshness, neverReported, packs } = deviceSummary(device, nowMs);
  const [collapsed, setCollapsed] = useState(freshness.status === "offline" && freshness.ageMs > COLLAPSE_AFTER_MS);
  if (neverReported || packs.length === 0) return null;

  const meta = FRESHNESS_META[freshness.status];
  const ageLabel = freshness.status === "offline" ? `Last known · ${formatAge(freshness.ageMs)}` : `${meta.label} · ${formatAge(freshness.ageMs)}`;
  const label = device.name || device.serialNumber;

  return (
    <div className="rounded-xl border border-gray-100 dark:border-gray-800 p-3">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
          <Link href={`/devices/${device.id}`} onClick={(e) => e.stopPropagation()} className="truncate text-xs font-semibold text-gray-700 hover:text-brand-500 dark:text-gray-300">
            {label}
          </Link>
          <span className="shrink-0 text-[10px] text-gray-400">{ageLabel}</span>
        </span>
        {collapsed ? <ChevronDownIcon className="h-4 w-4 shrink-0 text-gray-400" /> : <ChevronUpIcon className="h-4 w-4 shrink-0 text-gray-400" />}
      </button>

      {!collapsed && (
        <div className="mt-2 space-y-2">
          {packs.map((p) => (
            <PackGrid
              key={p.index}
              deviceId={device.id}
              deviceLabel={label}
              packIndex={p.index}
              cells={p.cells.map((c) => ({ index: c.index, voltage: c.voltage }))}
              isLive={freshness.status === "live"}
            />
          ))}
        </div>
      )}
    </div>
  );
}
// Memo per device: update WS pada satu device tidak memaksa heatmap device lain re-render.
const DeviceGroup = memo(DeviceGroupImpl);

export default function CellWall({ devices, nowMs }: { devices: Device[]; nowMs: number }) {
  // neverReported == packs kosong (lihat hasNeverReportedData) — cukup cek packs di sini, tanpa
  // menghitung deviceSummary penuh untuk keputusan filter yang murah ini.
  const withData = devices.filter((d) => d.packs.length > 0);
  const neverReportedCount = devices.length - withData.length;

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Cell Wall</h3>
        <span className="text-[10px] text-gray-400">Warna = deviasi dari rata-rata pack</span>
      </div>

      {withData.length === 0 ? (
        <p className="py-8 text-center text-xs text-gray-400">Belum ada cell untuk ditampilkan.</p>
      ) : (
        <div className="space-y-2">
          {withData.map((d) => (
            <DeviceGroup key={d.id} device={d} nowMs={nowMs} />
          ))}
        </div>
      )}
      {neverReportedCount > 0 && (
        <p className="mt-3 text-[10px] text-gray-400">{neverReportedCount} device belum pernah mengirim data (tidak ditampilkan).</p>
      )}
    </div>
  );
}
