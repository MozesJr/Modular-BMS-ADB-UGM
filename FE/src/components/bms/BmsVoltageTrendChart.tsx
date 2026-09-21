"use client";
import React from "react";
import dynamic from "next/dynamic";
import { ApexOptions } from "apexcharts";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

export default function BmsVoltageTrendChart() {
  const options: ApexOptions = {
    legend: { position: "top", horizontalAlign: "left" },
    colors: ["#465FFF", "#10B981"],
    chart: {
      fontFamily: "Outfit, sans-serif",
      height: 280,
      type: "line",
      toolbar: { show: false },
    },
    stroke: { curve: "smooth", width: [2, 2] },
    fill: {
      type: "gradient",
      gradient: { opacityFrom: 0.4, opacityTo: 0 },
    },
    grid: { yaxis: { lines: { show: true } } },
    dataLabels: { enabled: false },
    xaxis: {
      categories: ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00", "22:00"],
    },
    yaxis: {
      labels: { formatter: (v) => `${v.toFixed(1)}V` },
    },
  };

  const series = [
    { name: "Pack #1 Voltage", data: [52.4, 53.1, 54.2, 53.8, 52.9, 51.5, 50.8, 51.2] },
    { name: "Pack #2 Voltage", data: [52.2, 53.0, 54.0, 53.5, 52.7, 51.3, 50.6, 51.0] },
  ];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] sm:p-6 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            Pack Voltage Telemetry Trend <span className="ml-2 align-middle rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">DEMO</span>
          </h3>
          <p className="text-xs text-gray-500">Data contoh, bukan data perangkat. Riwayat tegangan nyata per device ada di halaman detail device.</p>
        </div>
      </div>
      <div className="max-w-full overflow-x-auto custom-scrollbar">
        <div className="min-w-[700px] xl:min-w-full">
          <Chart options={options} series={series} type="area" height={280} />
        </div>
      </div>
    </div>
  );
}