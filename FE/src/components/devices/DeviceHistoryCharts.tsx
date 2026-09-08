// FE/src/components/devices/DeviceHistoryCharts.tsx
"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { ApexOptions } from "apexcharts";
import { api, ApiError } from "@/lib/api";
import type { DeviceHistory } from "@/types/device";

const ReactApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

const RANGE_OPTIONS: { label: string; hours: number }[] = [
  { label: "6 Jam", hours: 6 },
  { label: "24 Jam", hours: 24 },
  { label: "7 Hari", hours: 24 * 7 },
];

const baseChartOptions: ApexOptions = {
  chart: {
    fontFamily: "Outfit, sans-serif",
    toolbar: { show: false },
    zoom: { enabled: false },
  },
  stroke: { curve: "smooth", width: 2 },
  dataLabels: { enabled: false },
  markers: { size: 0, hover: { size: 5 } },
  grid: { yaxis: { lines: { show: true } } },
  xaxis: {
    type: "datetime",
    labels: { datetimeUTC: false },
    axisBorder: { show: false },
    axisTicks: { show: false },
  },
  tooltip: { x: { format: "dd MMM HH:mm" } },
  legend: { position: "top", horizontalAlign: "left" },
};

export default function DeviceHistoryCharts({ deviceId }: { deviceId: string }) {
  const [history, setHistory] = useState<DeviceHistory | null>(null);
  const [hours, setHours] = useState(24);
  const [selectedPackIndex, setSelectedPackIndex] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    data: cell.voltage.map((point) => ({ x: new Date(point.recordedAt).getTime(), y: point.voltage })),
  }));

  const hasData = (history?.packs.length ?? 0) > 0;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h4 className="font-medium text-gray-800 dark:text-white/90">Riwayat Data</h4>
        <div className="flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-900">
          {RANGE_OPTIONS.map((opt) => (
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
          <div>
            <p className="mb-2 text-sm font-medium text-gray-700 dark:text-white/80">
              Temperature per Pack
            </p>
            <div className="max-w-full overflow-x-auto custom-scrollbar">
              <ReactApexChart
                options={{ ...baseChartOptions, colors: undefined, yaxis: { labels: { formatter: (v) => `${v.toFixed(1)}°C` } } }}
                series={temperatureSeries}
                type="area"
                height={260}
              />
            </div>
          </div>

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
                          ? "border-brand-500 text-brand-500"
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
              <ReactApexChart
                options={{ ...baseChartOptions, yaxis: { labels: { formatter: (v) => `${v.toFixed(3)}V` } } }}
                series={voltageSeries}
                type="line"
                height={260}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
