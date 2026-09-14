// FE/src/components/devices/DeviceHistoryCharts.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { ApexOptions } from "apexcharts";
import flatpickr from "flatpickr";
import "flatpickr/dist/flatpickr.min.css"; // Pastikan CSS flatpickr terimport
import { api, ApiError } from "@/lib/api";
import type { DeviceHistory } from "@/types/device";
import { CalenderIcon } from "../../icons";

const ReactApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

const RANGE_TABS = [
  { label: "6 Jam", hours: 6 },
  { label: "24 Jam", hours: 24 },
  { label: "7 Hari", hours: 24 * 7 },
];

// Batas aman voltage cell LiFePO4.
const SAFE_VOLTAGE_MIN = 2.5;
const SAFE_VOLTAGE_MAX = 3.65;

const voltageChartAnnotations: ApexOptions["annotations"] = {
  yaxis: [
    {
      y: SAFE_VOLTAGE_MIN,
      borderColor: "#f04438",
      strokeDashArray: 4,
      label: {
        text: "Min aman",
        borderColor: "#f04438",
        style: { color: "#fff", background: "#f04438" },
      },
    },
    {
      y: SAFE_VOLTAGE_MAX,
      borderColor: "#f79009",
      strokeDashArray: 4,
      label: {
        text: "Max aman",
        borderColor: "#f79009",
        style: { color: "#fff", background: "#f79009" },
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
    animations: {
      enabled: true,
      dynamicAnimation: { enabled: false },
    },
  },
  stroke: { curve: "smooth", width: 2 },
  dataLabels: { enabled: false },
  markers: { size: 0, hover: { size: 5 } },
  grid: {
    xaxis: { lines: { show: false } },
    yaxis: { lines: { show: true } },
  },
  xaxis: {
    type: "datetime",
    labels: { datetimeUTC: false },
    axisBorder: { show: false },
    axisTicks: { show: false },
    crosshairs: {
      show: true,
      position: "front",
      stroke: { color: "#98A2B3", width: 1, dashArray: 0 },
    },
  },
  tooltip: {
    shared: true,
    intersect: false,
    x: { format: "dd MMM HH:mm" },
  },
  legend: { position: "top", horizontalAlign: "left" },
};

export default function DeviceHistoryCharts({ deviceId }: { deviceId: string }) {
  const [history, setHistory] = useState<DeviceHistory | null>(null);
  const [hours, setHours] = useState(24);
  const [selectedPackIndex, setSelectedPackIndex] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const datePickerRef = useRef<HTMLInputElement>(null);

  // Inisialisasi Flatpickr
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
      prevArrow:
        '<svg class="stroke-current" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12.5 15L7.5 10L12.5 5" stroke="" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      nextArrow:
        '<svg class="stroke-current" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7.5 15L12.5 10L7.5 5" stroke="" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    });

    return () => {
      if (fp && !Array.isArray(fp)) {
        fp.destroy();
      }
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

  const temperatureSeries = (history?.packs ?? []).map((pack) => ({
    name: `Pack #${pack.index}`,
    data: pack.temperature
      .filter((point) => point.temperature != null)
      .map((point) => ({ x: new Date(point.recordedAt).getTime(), y: point.temperature as number })),
  }));

  const voltageSeries = (selectedPack?.cells ?? []).map((cell) => ({
    name: `Cell ${cell.index}`,
    data: cell.voltage.map((point) => ({ x: new Date(point.recordedAt).getTime(), y: cell.index === 1 ? point.voltage : point.voltage })),
  }));

  const hasData = (history?.packs.length ?? 0) > 0;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6 space-y-6">
      {/* Header dengan Tab dan DatePicker Flatpickr */}
      <div className="flex flex-col gap-5 sm:flex-row sm:justify-between sm:items-center">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            Riwayat Data
          </h3>
          <p className="mt-1 text-gray-500 text-theme-sm dark:text-gray-400">
            Grafik pemantauan suhu pack dan tegangan sel secara real-time
          </p>
        </div>

        <div className="flex items-center gap-3 sm:justify-end flex-wrap">
          {/* Tab Pilihan Jam/Hari */}
          <div className="flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-900">
            {RANGE_TABS.map((opt) => (
              <button
                key={opt.hours}
                onClick={() => setHours(opt.hours)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  hours === opt.hours
                    ? "shadow-theme-xs bg-white text-gray-900 dark:bg-gray-800 dark:text-white"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Flatpickr Date Picker */}
          <div className="relative inline-flex items-center">
            <CalenderIcon className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 lg:left-3 lg:top-1/2 lg:translate-x-0 lg:-translate-y-1/2 text-gray-500 dark:text-gray-400 pointer-events-none z-10" />
            <input
              ref={datePickerRef}
              className="h-10 w-10 lg:w-44 lg:h-auto lg:pl-10 lg:pr-3 lg:py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-transparent lg:text-gray-700 outline-none dark:border-gray-700 dark:bg-gray-800 dark:lg:text-gray-300 cursor-pointer"
              placeholder="Pilih rentang tanggal"
            />
          </div>
        </div>
      </div>

      {isLoading && (
        <p className="text-sm text-gray-500 dark:text-gray-400">Memuat riwayat...</p>
      )}
      {error && (
        <div className="rounded-lg bg-error-50 px-4 py-3 text-sm text-error-600 dark:bg-error-500/10 dark:text-error-400">
          {error}
        </div>
      )}

      {!isLoading && !error && !hasData && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Belum ada riwayat data pada rentang waktu ini.
        </p>
      )}

      {!isLoading && !error && hasData && (
        <>
          {/* Grafik Suhu */}
          <div>
            <p className="mb-2 text-sm font-medium text-gray-700 dark:text-white/80">
              Temperature per Pack
            </p>
            <div className="max-w-full overflow-x-auto custom-scrollbar">
              <div className="min-w-[800px] xl:min-w-full">
                <ReactApexChart
                  options={{
                    ...baseChartOptions,
                    colors: undefined,
                    yaxis: { labels: { formatter: (v) => `${v.toFixed(1)}°C` } },
                  }}
                  series={temperatureSeries}
                  type="area"
                  height={280}
                />
              </div>
            </div>
          </div>

          {/* Grafik Voltage */}
          <div>
            <div className="mb-2 flex items-center justify-between flex-wrap gap-2">
              <p className="text-sm font-medium text-gray-700 dark:text-white/80">
                Voltage per Cell {selectedPackIndex != null && `— Pack #${selectedPackIndex}`}
              </p>
              {history!.packs.length > 1 && (
                <div className="flex items-center gap-1 flex-wrap">
                  {history!.packs.map((pack) => (
                    <button
                      key={pack.index}
                      onClick={() => setSelectedPackIndex(pack.index)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium border ${
                        selectedPackIndex === pack.index
                          ? "border-brand-500 text-brand-500 bg-brand-50/10"
                          : "border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400"
                      }`}
                    >
                      Pack #{pack.index}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="max-w-full overflow-x-auto custom-scrollbar">
              <div className="min-w-[800px] xl:min-w-full">
                <ReactApexChart
                  options={{
                    ...baseChartOptions,
                    yaxis: { labels: { formatter: (v) => `${v.toFixed(3)}V` } },
                    annotations: voltageChartAnnotations,
                  }}
                  series={voltageSeries}
                  type="line"
                  height={280}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}