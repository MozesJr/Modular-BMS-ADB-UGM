"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import type { Device, DevicesSummary, DeviceSparkPoint } from "@/types/device";
import { useBmsSocket } from "@/hooks/useBmsSocket";
import { applyRealtimeUpdate } from "@/lib/realtimeMerge";
import DeviceCard, { deviceSummary } from "@/components/devices/DeviceCard";
import { CardGridSkeleton, Skeleton } from "@/components/common/Skeleton";
import ErrorState from "@/components/common/ErrorState";

function Kpi({ label, value, sub, tone = "default" }: { label: string; value: string; sub?: string; tone?: "default" | "danger" | "ok" }) {
  const valueColor = tone === "danger" ? "text-red-600 dark:text-red-400" : tone === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-gray-900 dark:text-white";
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] shadow-sm">
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</span>
      <div className={`mt-1 text-title-sm font-bold tabular-nums ${valueColor}`}>{value}</div>
      {sub && <span className="text-xs text-gray-400">{sub}</span>}
    </div>
  );
}

export default function FleetDashboard() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [sparkById, setSparkById] = useState<Map<string, DeviceSparkPoint[]>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  async function load(cancelledRef?: { current: boolean }) {
    setIsLoading(true);
    setError(null);
    try {
      // Satu request device (live KPI) + satu request summary (sparkline) — bukan N per device.
      const [data, summary] = await Promise.all([
        api.get<Device[]>("/devices"),
        api.get<DevicesSummary>("/devices/summary?hours=6").catch(() => null),
      ]);
      if (cancelledRef?.current) return;
      setDevices(data);
      if (summary) setSparkById(new Map(summary.devices.map((s) => [s.id, s.spark])));
    } catch (err) {
      if (!cancelledRef?.current) setError(err instanceof ApiError ? err.message : "Gagal memuat data device.");
    } finally {
      if (!cancelledRef?.current) setIsLoading(false);
    }
  }

  useEffect(() => {
    const ref = { current: false };
    load(ref);
    return () => {
      ref.current = true;
    };
  }, []);

  useBmsSocket((update) => {
    setDevices((prev) => prev.map((d) => (d.id === update.id ? applyRealtimeUpdate(d, update) : d)));
  });

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const kpi = useMemo(() => {
    const summaries = devices.map((d) => ({ d, s: deviceSummary(d, now) }));
    const online = summaries.filter((x) => x.s.freshness.status === "live").length;
    const packs = summaries.reduce((sum, x) => sum + x.s.packs.length, 0);
    const cells = summaries.reduce((sum, x) => sum + x.s.cellCount, 0);
    const alarms = summaries.reduce((sum, x) => sum + x.s.alarms.length, 0);
    // Daya live = jumlah power device yang sedang live.
    const totalPower = summaries
      .filter((x) => x.s.freshness.status === "live")
      .reduce((sum, x) => sum + x.s.totalPower, 0);
    // Device imbalance terburuk.
    let worst: { d: Device; delta: number } | null = null;
    for (const x of summaries) {
      if (worst == null || x.s.worstDelta > worst.delta) worst = { d: x.d, delta: x.s.worstDelta };
    }
    return { online, total: devices.length, packs, cells, alarms, totalPower, worst };
  }, [devices, now]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Fleet Overview</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">Ringkasan real-time seluruh unit BMS yang kamu pantau.</p>
      </div>

      {error && !isLoading && <ErrorState message={error} onRetry={() => load()} />}

      {isLoading && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <CardGridSkeleton count={6} />
        </div>
      )}

      {!isLoading && !error && devices.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 px-6 py-16 text-center bg-gray-50/50 dark:bg-white/[0.02]">
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Belum ada device BMS terpantau.</p>
          <p className="text-xs text-gray-400 mt-1">Daftarkan unit lewat halaman My Devices untuk mulai memantau.</p>
          <Link href="/devices" className="inline-block mt-4 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600">+ Tambah Device</Link>
        </div>
      )}

      {!isLoading && !error && devices.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Device Online" value={`${kpi.online}/${kpi.total}`} sub="live sekarang" tone={kpi.online > 0 ? "ok" : "default"} />
            <Kpi label="Pack Dipantau" value={String(kpi.packs)} />
            <Kpi label="Cell Dipantau" value={String(kpi.cells)} />
            <Kpi label="Alarm Aktif" value={String(kpi.alarms)} tone={kpi.alarms > 0 ? "danger" : "ok"} />
            <Kpi label="Daya Live" value={`${kpi.totalPower.toFixed(0)} W`} sub="jumlah pack live" />
            <Link href={kpi.worst && kpi.worst.delta > 0 ? `/devices/${kpi.worst.d.id}` : "#"} className="block">
              <Kpi label="Imbalance Terburuk" value={kpi.worst && kpi.worst.delta > 0 ? `${kpi.worst.delta} mV` : "—"} sub={kpi.worst && kpi.worst.delta > 0 ? (kpi.worst.d.name || kpi.worst.d.serialNumber) : "aman"} tone={kpi.worst && kpi.worst.delta > 50 ? "danger" : "default"} />
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {devices.map((d) => (
              <DeviceCard key={d.id} device={d} variant="compact" nowMs={now} spark={sparkById.get(d.id)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
