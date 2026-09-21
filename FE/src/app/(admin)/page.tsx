import type { Metadata } from "next";
import React from "react";
import BmsSystemMetrics from "@/components/bms/BmsSystemMetrics";
import BmsPowerFlowChart from "@/components/bms/BmsPowerFlowChart";
import BmsVoltageTrendChart from "@/components/bms/BmsVoltageTrendChart";
import BmsActiveDevicesList from "@/components/bms/BmsActiveDevicesList";

export const metadata: Metadata = {
  title: "GAMA BMS Dashboard - System Telemetry",
  description: "Global monitoring dashboard for modular universal Battery Management Systems",
};

export default function BmsDashboard() {
  return (
    <div className="grid grid-cols-12 gap-4 md:gap-6">
      {/* Baris 1: ringkasan nyata dari /api/v1/dashboard/summary */}
      <div className="col-span-12">
        <BmsSystemMetrics />
      </div>

      {/* Baris 2: Grafik aliran daya (DEMO: data contoh). Kartu SoH dihapus: SoC/SoH belum ada di payload perangkat. */}
      <div className="col-span-12">
        <BmsPowerFlowChart />
      </div>

      {/* Baris 3: Grafik Telemetri Grafik Tegangan/Suhu Historis ala Grafana */}
      <div className="col-span-12">
        <BmsVoltageTrendChart />
      </div>

      {/* Baris 4: Tabel / List Ringkasan Unit Perangkat BMS yang Aktif */}
      <div className="col-span-12">
        <BmsActiveDevicesList />
      </div>
    </div>
  );
}