"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { ApexOptions } from "apexcharts";
import flatpickr from "flatpickr";
import "flatpickr/dist/flatpickr.min.css";
import { api, ApiError } from "@/lib/api";
import type { DeviceHistory } from "@/types/device";
import { CalenderIcon } from "../../icons";

const ReactApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

const RANGE_TABS = [
  { label: "6 Jam", hours: 6 },
  { label: "24 Jam", hours: 24 },
  { label: "7 Hari", hours: 24 * 7 },
];

const SAFE_VOLTAGE_MIN = 2.5;
const SAFE_VOLTAGE_MAX = 3.65;

const voltageChartAnnotations: ApexOptions["annotations"] = {
  yaxis: [
    {
      y: SAFE_VOLTAGE_MIN,
      borderColor: "#f04438",
      strokeDashArray: 4,
      label: {
        text: "Min Aman (2.5V)",
        borderColor: "#f04438",
        style: { color: "#fff", background: "#f04438", fontSize: "10px" },
      },
    },
    {
      y: SAFE_VOLTAGE_MAX,
      borderColor: "#f79009",
      strokeDashArray: 4,
      label: {
        text: "Max Aman (3.65V)",
        borderColor: "#f79009",
        style: { color: "#fff", background: "#f79009", fontSize: "10px" },
      },
    },
  ],
};

const baseChartOptions: ApexOptions = {
  chart: {
    fontFamily: "Outfit, sans-serif",
    toolbar: {
      show: true,
      tools: { zoom: true, zoomin: true, zoomout: true, pan: true, reset: true },
    },
    zoom: { enabled: true, type: "x" },
    animations: { enabled: false },
  },
  stroke: { curve: "smooth", width: 2 },
  dataLabels: { enabled: false },
  markers: { size: 0, hover: { size: 4 } },
  grid: {
    borderColor: "#e5e7eb",
    xaxis: { lines: { show: false } },
    yaxis: { lines: { show: true } },
  },
  xaxis: {
    type: "datetime",
    labels: { datetimeUTC: false, style: { colors: "#6b7280", fontSize: "11px" } },
    axisBorder: { show: false },
    axisTicks: { show: false },
  },
  tooltip: {
    shared: true,
    intersect: false,
    x: { format: "dd MMM yyyy, HH:mm" },
  },
  legend: { 
    position: "bottom", 
    horizontalAlign: "center",
    fontSize: "12px",
    markers: { size: 5, shape: "square" }
  },
};

export default function DeviceHistoryCharts({ deviceId }: { deviceId: string }) {
  const [history, setHistory] = useState<DeviceHistory | null>(null);
  const [hours, setHours] = useState(24);
  const [selectedPackIndex, setSelectedPackIndex] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const datePickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!datePickerRef.current) return;
    const today = new Date();
    const pastDate = new Date();
    pastDate.setHours(today.getHours() - hours);

    const fp = flatpickr(datePickerRef.current, {
      mode: "range",
      static: true,
      monthSelectorType: "static",
      dateFormat: "M d, Y",
      defaultDate: [pastDate, today],
      clickOpens: true,
    });

    return () => {
      if (fp && !Array.isArray(fp)) fp.destroy();
    };
  }, [hours]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await api.get<DeviceHistory>(
          `/devices/${deviceId}/history?hours=${hours}`,
        );
        if (cancelled) return;
        setHistory(data);
        setSelectedPackIndex((prev) =>
          prev != null && data.packs.some((p) => p.index === prev)
            ? prev
            : (data.packs[0]?.index ?? null),
        );
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Gagal memuat riwayat data.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [deviceId, hours]);

  const selectedPack = history?.packs.find((p) => p.index === selectedPackIndex) ?? null;

  // Hitung Statistik Ringkasan BMS untuk Pack Terpilih
  const allVoltages = selectedPack?.cells.flatMap(c => c.voltage.map(v => v.voltage)) || [];
  const maxVoltage = allVoltages.length ? Math.max(...allVoltages).toFixed(3) : "0.000";
  const minVoltage = allVoltages.length ? Math.min(...allVoltages).toFixed(3) : "0.000";
  const voltageDelta = allVoltages.length ? ((Number(maxVoltage) - Number(minVoltage)) * 1000).toFixed(0) : "0";

  const temperatureSeries = (history?.packs ?? []).map((pack) => ({
    name: `Pack #${pack.index}`,
    data: pack.temperature
      .filter((point) => point.temperature != null)
      .map((point) => ({ x: new Date(point.recordedAt).getTime(), y: point.temperature as number })),
  }));

  const voltageSeries = (selectedPack?.cells ?? []).map((cell) => ({
    name: `Cell ${cell.index}`,
    data: cell.voltage.map((point) => ({ x: new Date(point.recordedAt).getTime(), y: point.voltage })),
  }));

  const hasData = (history?.packs.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      {/* CARD UTAMA: KONTROL & HEADER */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-center border-b border-gray-100 dark:border-gray-800 pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-brand-500 animate-pulse"></span>
              <h3 className="text-lg font-bold text-gray-800 dark:text-white/90">
                BMS Analytics & Telemetry History
              </h3>
            </div>
            <p className="mt-1 text-gray-500 text-theme-sm dark:text-gray-400">
              Analisis performa sel, tren temperatur pack, dan kestabilan tegangan sistem
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Tab Rentang Waktu */}
            <div className="flex items-center gap-0.5 rounded-lg bg-gray-100 p-1 dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
              {RANGE_TABS.map((opt) => (
                <button
                  key={opt.hours}
                  onClick={() => setHours(opt.hours)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                    hours === opt.hours
                      ? "shadow-sm bg-white text-gray-900 dark:bg-gray-800 dark:text-white"
                      : "text-gray-500 dark:text-gray-400 hover:text-gray-800"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Date Picker */}
            <div className="relative inline-flex items-center">
              <CalenderIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 pointer-events-none z-10" />
              <input
                ref={datePickerRef}
                className="h-10 pl-9 pr-4 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-700 outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 cursor-pointer shadow-sm"
                placeholder="Pilih tanggal"
              />
            </div>
          </div>
        </div>

        {/* STATS MINI BAR (BMS QUICK METRICS) */}
        {!isLoading && !error && hasData && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 my-5">
            <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-800">
              <span className="text-xs text-gray-500 dark:text-gray-400 block">Max Cell Voltage</span>
              <span className="text-base font-bold text-gray-800 dark:text-white">{maxVoltage} V</span>
            </div>
            <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-800">
              <span className="text-xs text-gray-500 dark:text-gray-400 block">Min Cell Voltage</span>
              <span className="text-base font-bold text-gray-800 dark:text-white">{minVoltage} V</span>
            </div>
            <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-800">
              <span className="text-xs text-gray-500 dark:text-gray-400 block">Cell Delta (Imbalance)</span>
              <span className="text-base font-bold text-amber-600 dark:text-amber-400">{voltageDelta} mV</span>
            </div>
            <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-800">
              <span className="text-xs text-gray-500 dark:text-gray-400 block">Active Pack Monitored</span>
              <span className="text-base font-bold text-brand-600 dark:text-brand-400">Pack #{selectedPackIndex ?? 1}</span>
            </div>
          </div>
        )}

        {isLoading && <div className="py-12 text-center text-sm text-gray-500">Memuat data histori telemetry...</div>}
        {error && <div className="rounded-lg bg-red-50 p-4 text-sm text-red-600 my-4">{error}</div>}

        {!isLoading && !error && !hasData && (
          <div className="py-12 text-center text-sm text-gray-500">Belum ada riwayat data pada rentang waktu ini.</div>
        )}

        {!isLoading && !error && hasData && (
          <div className="space-y-8">
            {/* GRAFIK SUHU */}
            <div className="p-4 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/20">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-gray-700 dark:text-white/90 flex items-center gap-2">
                  🌡️ Temperature Trend per Pack
                </h4>
              </div>
              <div className="max-w-full overflow-x-auto custom-scrollbar">
                <div className="min-w-[700px]">
                  <ReactApexChart
                    options={{
                      ...baseChartOptions,
                      yaxis: { labels: { formatter: (v) => `${v.toFixed(1)}°C` } },
                    }}
                    series={temperatureSeries}
                    type="area"
                    height={260}
                  />
                </div>
              </div>
            </div>

            {/* GRAFIK VOLTAGE CELL */}
            <div className="p-4 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/20">
              <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
                <h4 className="text-sm font-bold text-gray-700 dark:text-white/90 flex items-center gap-2">
                  ⚡ Cell Voltages Breakdown
                </h4>
                
                {/* Selector Pack jika lebih dari 1 */}
                {history!.packs.length > 1 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs text-gray-500 mr-1">Pilih Pack:</span>
                    {history!.packs.map((pack) => (
                      <button
                        key={pack.index}
                        onClick={() => setSelectedPackIndex(pack.index)}
                        className={`px-3 py-1 rounded-md text-xs font-semibold border transition-all ${
                          selectedPackIndex === pack.index
                            ? "border-brand-500 text-brand-600 bg-brand-50 dark:bg-brand-500/10 dark:text-brand-400"
                            : "border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-400 hover:bg-gray-100"
                        }`}
                      >
                        Pack #{pack.index}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="max-w-full overflow-x-auto custom-scrollbar">
                <div className="min-w-[700px]">
                  <ReactApexChart
                    options={{
                      ...baseChartOptions,
                      yaxis: { 
                        min: 2.0,
                        max: 4.0,
                        labels: { formatter: (v) => `${v.toFixed(3)}V` } 
                      },
                      annotations: voltageChartAnnotations,
                    }}
                    series={voltageSeries}
                    type="line"
                    height={300}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}