"use client";
import React from "react";
import Link from "next/link";
import Badge from "../ui/badge/Badge";
import { BoxIconLine } from "@/icons";
import { useApiResource } from "@/hooks/useApiResource";
import type { components } from "@/types/api-v1";

type DashboardSummary = components["schemas"]["DashboardSummary"];

const fmt = (n: number | null, digits = 1) => (n === null ? "—" : n.toLocaleString("id-ID", { maximumFractionDigits: digits }));

function Card({
  icon,
  tone,
  badge,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  tone: string;
  badge: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div className={`flex items-center justify-center w-12 h-12 rounded-xl ${tone}`}>{icon}</div>
        {badge}
      </div>
      <div className="mt-4">
        <span className="text-sm text-gray-500 dark:text-gray-400 font-medium">{label}</span>
        <div className="flex items-baseline justify-between mt-1">
          <h4 className="font-bold text-gray-900 text-title-sm dark:text-white">{value}</h4>
          {hint && <span className="text-xs text-gray-500">{hint}</span>}
        </div>
      </div>
    </div>
  );
}

const svg = (d: string) => (
  <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />
  </svg>
);

// Angka nyata dari GET /api/v1/dashboard/summary. Tidak ada SoC/SoH (belum ada di payload perangkat).
export default function BmsSystemMetrics() {
  const { data, error, isLoading } = useApiResource<DashboardSummary>("/v1/dashboard/summary");

  if (isLoading && !data) {
    return <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-500 dark:border-gray-800 dark:bg-white/[0.03]">Memuat ringkasan…</div>;
  }
  if (!data) {
    return <div className="rounded-xl bg-red-50 p-4 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{error ?? "Ringkasan tidak tersedia."}</div>;
  }
  if (data.deviceCount === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 px-6 py-10 text-center dark:border-gray-700">
        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Belum ada device.</p>
        <Link href="/devices" className="mt-1 inline-block text-sm text-brand-500 hover:underline">Daftarkan device pertama →</Link>
      </div>
    );
  }

  const power = data.totalPowerW;
  const powerBadge =
    power === null ? <Badge color="light">Tidak ada data</Badge> : power < 0 ? <Badge color="info">Charging</Badge> : power > 0 ? <Badge color="warning">Discharging</Badge> : <Badge color="light">Idle</Badge>;

  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-amber-600">Gagal menyegarkan ({error}); menampilkan data terakhir.</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 md:gap-6">
        <Card
          icon={<BoxIconLine className="size-6" />}
          tone="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"
          badge={<Badge color={data.offlineCount === 0 ? "success" : "warning"}>{data.offlineCount === 0 ? "Semua online" : `${data.offlineCount} offline`}</Badge>}
          label="Device online"
          value={`${data.onlineCount} / ${data.deviceCount}`}
        />
        <Card
          icon={svg("M13 10V3L4 14h7v7l9-11h-7z")}
          tone="bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400"
          badge={powerBadge}
          label="Total daya (device online)"
          value={power === null ? "—" : `${fmt(power, 0)} W`}
          hint={power !== null && power < 0 ? "negatif = mengisi" : undefined}
        />
        <Card
          icon={svg("M12 3v9.5a4 4 0 11-2 0V3a1 1 0 012 0z")}
          tone="bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400"
          badge={<Badge color="info">Maks</Badge>}
          label="Suhu tertinggi"
          value={data.maxTemperatureC === null ? "—" : `${fmt(data.maxTemperatureC)} °C`}
        />
        <Card
          icon={svg("M4 6h16M4 12h10M4 18h6")}
          tone="bg-purple-50 text-purple-600 dark:bg-purple-500/10 dark:text-purple-400"
          badge={data.pendingVerificationCount > 0 ? <Badge color="warning">{data.pendingVerificationCount} menunggu verifikasi</Badge> : <Badge color="light">Terverifikasi</Badge>}
          label="Delta cell tertinggi"
          value={data.maxCellDeltaMv === null ? "—" : `${fmt(data.maxCellDeltaMv, 0)} mV`}
        />
      </div>
    </div>
  );
}
