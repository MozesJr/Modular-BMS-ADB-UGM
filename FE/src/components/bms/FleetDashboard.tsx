"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import type { Device, DevicesSummary, DeviceSparkPoint } from "@/types/device";
import { useBmsSocket } from "@/hooks/useBmsSocket";
import { applyRealtimeUpdate } from "@/lib/realtimeMerge";
import { deviceSummary } from "@/lib/deviceSummary";
import { computeFleetKpi } from "@/lib/fleetKpi";
import DeviceCard from "@/components/devices/DeviceCard";
import FleetPulse from "@/components/bms/FleetPulse";
import CellWall from "@/components/bms/CellWall";
import NeedsAttention from "@/components/bms/NeedsAttention";
import HealthDistribution from "@/components/bms/HealthDistribution";
import LiveEventFeed from "@/components/bms/LiveEventFeed";
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
  const [energyTodayById, setEnergyTodayById] = useState<Map<string, { inWh: number; outWh: number }>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  async function load(cancelledRef?: { current: boolean }) {
    setIsLoading(true);
    setError(null);
    try {
      // Satu request device (live KPI) + satu request summary (sparkline + energi hari ini) —
      // bukan N per device.
      const [data, summary] = await Promise.all([
        api.get<Device[]>("/devices"),
        api.get<DevicesSummary>("/devices/summary?hours=6").catch(() => null),
      ]);
      if (cancelledRef?.current) return;
      setDevices(data);
      if (summary) {
        setSparkById(new Map(summary.devices.map((s) => [s.id, s.spark])));
        setEnergyTodayById(new Map(summary.devices.map((s) => [s.id, { inWh: s.energyTodayInWh, outWh: s.energyTodayOutWh }])));
      }
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

  // Ringkasan per device — dipakai komponen agregat (KPI, Needs Attention, Health Distribution,
  // Live Event Feed). Komponen berat per-device (CellWall, DeviceCard) MENGHITUNG SENDIRI
  // deviceSummary() dari props {device, nowMs} dan di-React.memo di level situ, supaya update WS
  // pada satu device tidak memaksa re-render/re-heatmap device lain — tanpa cache lintas-render
  // manual (ref during render dilarang oleh aturan React/compiler-eslint di proyek ini).
  const summaries = useMemo(() => {
    const m = new Map<string, ReturnType<typeof deviceSummary>>();
    for (const d of devices) m.set(d.id, deviceSummary(d, now));
    return m;
  }, [devices, now]);
  const kpi = useMemo(() => computeFleetKpi(devices, summaries), [devices, summaries]);
  const energyTodayTotal = useMemo(() => {
    let inWh = 0;
    let outWh = 0;
    for (const d of devices) {
      const e = energyTodayById.get(d.id);
      if (!e) continue;
      inWh += e.inWh;
      outWh += e.outWh;
    }
    return { inWh, outWh };
  }, [devices, energyTodayById]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Fleet Overview</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">Ringkasan real-time seluruh unit BMS yang kamu pantau.</p>
      </div>

      {error && !isLoading && <ErrorState message={error} onRetry={() => load()} />}

      {isLoading && (
        <div className="space-y-6">
          <Skeleton className="h-40" />
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
          <FleetPulse kpi={kpi} nowMs={now} energyToday={energyTodayTotal} />

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Device Live" value={`${kpi.liveCount}/${kpi.total}`} sub={`${kpi.staleCount} stale · ${kpi.offlineCount} offline`} tone={kpi.liveCount > 0 ? "ok" : "default"} />
            <Kpi label="Pack Dipantau" value={String(kpi.packs)} />
            <Kpi label="Cell Dipantau" value={String(kpi.cells)} />
            <Kpi label="Alarm Aktif" value={String(kpi.activeAlarmCount)} sub="device live" tone={kpi.activeAlarmCount > 0 ? "danger" : "ok"} />
            <Kpi label="Daya Net" value={`${kpi.netW > 0 ? "+" : ""}${kpi.netW.toFixed(0)} W`} sub={`${kpi.chargeW.toFixed(0)} W in · ${kpi.dischargeW.toFixed(0)} W out`} />
            <Link href={kpi.worst && kpi.worst.deltaMv > 0 ? `/devices/${kpi.worst.device.id}` : "#"} className="block">
              <Kpi
                label="Imbalance Terburuk"
                value={kpi.worst && kpi.worst.deltaMv > 0 ? `${kpi.worst.deltaMv} mV` : "—"}
                sub={kpi.worst && kpi.worst.deltaMv > 0 ? (kpi.worst.device.name || kpi.worst.device.serialNumber) : "aman (live)"}
                tone={kpi.worst && kpi.worst.deltaMv > 50 ? "danger" : "default"}
              />
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <CellWall devices={devices} nowMs={now} />
            </div>
            <NeedsAttention devices={devices} summaries={summaries} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <HealthDistribution devices={devices} summaries={summaries} />
            <LiveEventFeed devices={devices} summaries={summaries} nowMs={now} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {devices.map((d) => (
              <DeviceCard key={d.id} device={d} variant="compact" nowMs={now} spark={sparkById.get(d.id)} energyToday={energyTodayById.get(d.id)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
