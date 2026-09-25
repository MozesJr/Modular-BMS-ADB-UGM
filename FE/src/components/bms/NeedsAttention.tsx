"use client";
import Link from "next/link";
import type { Device } from "@/types/device";
import type { DeviceSummary } from "@/lib/deviceSummary";
import { formatAge } from "@/lib/freshness";
import { ALERT_THRESHOLDS } from "@/lib/alertRules";
import { AlertIcon, InfoIcon, CheckLineIcon } from "@/icons";

type Category = "alarm" | "stale" | "offline" | "nearing";
const CATEGORY_ORDER: Category[] = ["alarm", "stale", "offline", "nearing"];
const CATEGORY_META: Record<Category, { label: string; badge: string }> = {
  alarm: { label: "Alarm aktif", badge: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400" },
  stale: { label: "Stale", badge: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400" },
  offline: { label: "Offline", badge: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" },
  nearing: { label: "Mendekati ambang", badge: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400" },
};

// Ambang "mendekati" imbalance = 70% dari ambang warning — dini tapi belum jadi alarm.
const NEARING_RATIO = 0.7;

type AttentionItem = { device: Device; category: Category; detail: string };

function buildAttentionList(devices: Device[], summaries: Map<string, DeviceSummary>): AttentionItem[] {
  const items: AttentionItem[] = [];
  const nearingFloor = ALERT_THRESHOLDS.imbalanceWarnMv * NEARING_RATIO;

  for (const device of devices) {
    const s = summaries.get(device.id);
    if (!s) continue;

    if (s.realAlarms.length > 0 && s.freshness.status !== "offline") {
      items.push({
        device,
        category: "alarm",
        detail: s.realAlarms.length === 1 ? s.realAlarms[0].message : `${s.realAlarms.length} alarm aktif`,
      });
      continue;
    }
    if (s.freshness.status === "stale") {
      items.push({ device, category: "stale", detail: `Stale · ${formatAge(s.freshness.ageMs)}` });
      continue;
    }
    if (s.freshness.status === "offline") {
      items.push({
        device,
        category: "offline",
        detail: s.neverReported ? "Belum ada data" : `Last known · ${formatAge(s.freshness.ageMs)}`,
      });
      continue;
    }
    if (s.worstDelta >= nearingFloor && s.worstDelta < ALERT_THRESHOLDS.imbalanceWarnMv) {
      items.push({
        device,
        category: "nearing",
        detail: `Delta ${s.worstDelta} mV, mendekati ambang ${ALERT_THRESHOLDS.imbalanceWarnMv} mV`,
      });
    }
  }

  return items.sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));
}

export default function NeedsAttention({ devices, summaries }: { devices: Device[]; summaries: Map<string, DeviceSummary> }) {
  const items = buildAttentionList(devices, summaries);

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-200">Needs Attention</h3>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <CheckLineIcon className="h-6 w-6 text-emerald-500" />
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Semua sistem normal.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={`${item.device.id}-${item.category}`}>
              <Link
                href={`/devices/${item.device.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2 transition-colors hover:border-brand-500 hover:bg-gray-50 dark:hover:bg-white/[0.04]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-gray-800 dark:text-gray-100">
                    {item.device.name || item.device.serialNumber}
                  </span>
                  <span className="block truncate text-[11px] text-gray-400">{item.detail}</span>
                </span>
                <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${CATEGORY_META[item.category].badge}`}>
                  {item.category === "alarm" ? <AlertIcon className="h-3 w-3" /> : <InfoIcon className="h-3 w-3" />}
                  {CATEGORY_META[item.category].label}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
