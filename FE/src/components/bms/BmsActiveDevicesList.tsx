"use client";
import React from "react";
import Link from "next/link";
import Badge from "../ui/badge/Badge";
import { BoxIconLine } from "@/icons";
import { useApiResource } from "@/hooks/useApiResource";
import type { components } from "@/types/api-v1";

type DeviceListResponse = components["schemas"]["DeviceListResponse"];

// Daftar device nyata dari GET /api/v1/devices?view=summary (halaman pertama).
export default function BmsActiveDevicesList() {
  const { data, error, isLoading } = useApiResource<DeviceListResponse>("/v1/devices?view=summary&limit=50");

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] sm:p-6 shadow-sm">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Device Saya</h3>
        <p className="text-xs text-gray-500">Tegangan pack, suhu, dan status terkini tiap device</p>
      </div>

      {isLoading && !data && <p className="py-6 text-center text-sm text-gray-500">Memuat…</p>}
      {!data && error && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{error}</div>}
      {data && data.items.length === 0 && <p className="py-6 text-center text-sm text-gray-500">Belum ada device.</p>}

      {data && data.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 text-xs font-semibold text-gray-400 uppercase">
                <th className="py-3 px-4">Device</th>
                <th className="py-3 px-4">Konfigurasi</th>
                <th className="py-3 px-4">Tegangan pack</th>
                <th className="py-3 px-4">Suhu maks</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-sm">
              {data.items.map((d) => {
                const packs = d.summary?.packs ?? [];
                const sensorError = packs.some((p) => p.temperatureC === null);
                return (
                  <tr key={d.id} className="hover:bg-gray-50/50 dark:hover:bg-white/[0.02]">
                    <td className="py-3.5 px-4 font-medium text-gray-800 dark:text-white">
                      <Link href={`/devices/${d.id}`} className="hover:text-brand-500">
                        <div>{d.name || d.serialNumber}</div>
                        <span className="text-xs text-gray-400 font-mono">{d.serialNumber}</span>
                      </Link>
                    </td>
                    <td className="py-3.5 px-4 text-gray-500">
                      <span className="inline-flex items-center gap-1.5"><BoxIconLine className="size-4" /> {d.packCount} Pack</span>
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-gray-800 dark:text-white">
                      {packs.length === 0 ? "—" : packs.map((p) => (p.voltageV === null ? "—" : `${p.voltageV.toFixed(2)} V`)).join(" · ")}
                    </td>
                    <td className="py-3.5 px-4 text-gray-600 dark:text-gray-300">
                      {d.summary?.maxTemperatureC != null ? `${d.summary.maxTemperatureC.toFixed(1)} °C` : "—"}
                      {sensorError && <span className="ml-2 text-xs text-amber-600" title="Sensor suhu error / tidak ada pembacaan">sensor error</span>}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge size="sm" color={d.online ? "success" : "light"}>{d.online ? "Online" : "Offline"}</Badge>
                        {!d.verified && <Badge size="sm" color="warning">Pending</Badge>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data.nextCursor && <p className="pt-3 text-xs text-gray-500">Menampilkan 50 device pertama. <Link href="/devices" className="text-brand-500 hover:underline">Lihat semua</Link></p>}
        </div>
      )}
    </div>
  );
}
