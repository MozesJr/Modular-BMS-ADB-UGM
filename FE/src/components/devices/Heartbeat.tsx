"use client";
import { FRESHNESS_META, formatAge, type Freshness } from "@/lib/freshness";

// Strip "last packet Ns ago" + dot pulse dari getFreshness. `ageMs` di-update tiap detik
// oleh parent (DeviceDetail menyimpan `now` yang tick per detik).
export default function Heartbeat({ status, ageMs }: { status: Freshness; ageMs: number }) {
  const meta = FRESHNESS_META[status];
  const live = status === "live";
  return (
    <div className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 px-3 py-1.5">
      <span className="relative flex h-2.5 w-2.5" aria-hidden>
        {live && <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 heartbeat-dot" />}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${meta.dot}`} />
      </span>
      <span className={`text-xs font-semibold ${meta.text}`}>{meta.label}</span>
      <span className="text-xs text-gray-400 tabular-nums">
        · last packet {formatAge(ageMs)}
      </span>
    </div>
  );
}
