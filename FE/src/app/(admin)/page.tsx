import type { Metadata } from "next";
import React from "react";
import BmsSystemMetrics1 from "@/components/bms/BmsSystemMetrics";
import BmsPowerFlowChart from "@/components/bms/BmsPowerFlowChart";
import BmsVoltageTrendChart from "@/components/bms/BmsVoltageTrendChart";
import BmsActiveDevicesList from "@/components/bms/BmsActiveDevicesList";
import BmsEnergyDistributionCard from "@/components/bms/BmsEnergyDistributionCard";

export const metadata: Metadata = {
  title: "GAMA BMS Dashboard - System Telemetry",
  description: "Global monitoring dashboard for modular universal Battery Management Systems",
};

export default function BmsDashboard() {
  return (
    <div className="grid grid-cols-12 gap-4 md:gap-6">
      {/* Baris 1: Kartu Metrik Utama Sistem (Total Power, SOC Rata-rata, Arus, Tegangan) */}
      <div className="col-span-12">
        <BmsSystemMetrics1 />
      </div>

      {/* Baris 2: Grafik Aliran Daya / Power Flow & Monthly Target (Dial / Radial SoC) */}
      <div className="col-span-12 space-y-6 xl:col-span-7">
        <BmsPowerFlowChart />
      </div>

      <div className="col-span-12 xl:col-span-5">
        <BmsEnergyDistributionCard />
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