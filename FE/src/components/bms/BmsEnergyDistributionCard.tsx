"use client";
import React from "react";
import { ApexOptions } from "apexcharts";
import dynamic from "next/dynamic";

const ReactApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

export default function BmsEnergyDistributionCard() {
  const series = [88.5]; // State of Health (SoH)
  const options: ApexOptions = {
    colors: ["#10B981"],
    chart: {
      fontFamily: "Outfit, sans-serif",
      type: "radialBar",
      height: 230, // Sedikit disesuaikan agar lebih proporsional
      sparkline: { enabled: true },
    },
    plotOptions: {
      radialBar: {
        startAngle: -90,
        endAngle: 90,
        hollow: { size: "70%" },
        track: { background: "#E4E7EC", strokeWidth: "100%" },
        dataLabels: {
          name: { show: false },
          value: {
            fontSize: "28px",
            fontWeight: "700",
            offsetY: -22, // Dinaikkan ke atas agar tidak menumpuk dengan badge
            color: "#1D2939",
            formatter: (val) => `${val}%`,
          },
        },
      },
    },
    stroke: { lineCap: "round" },
    labels: ["System Health"],
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] sm:p-6 shadow-sm flex flex-col justify-between h-full">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Battery Bank SoH</h3>
          <p className="text-xs text-gray-500">State of Health rata-rata seluruh sel aktif</p>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15">
          Optimal
        </span>
      </div>

      <div className="my-auto py-4 relative">
        <ReactApexChart options={options} series={series} type="radialBar" height={210} />
        {/* Posisi teks keterangan diposisikan secara aman di bawah grafik */}
        <div className="text-center mt-2">
          <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">
            Performance status is operating within normal parameters.
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 pt-4 border-t border-gray-100 dark:border-gray-800 text-center">
        <div>
          <span className="text-xs text-gray-400 block">Cell Imbalance</span>
          <span className="text-sm font-bold text-gray-800 dark:text-white">4 mV (Safe)</span>
        </div>
        <div>
          <span className="text-xs text-gray-400 block">Max Temperature</span>
          <span className="text-sm font-bold text-gray-800 dark:text-white">28.4 °C</span>
        </div>
      </div>
    </div>
  );
}