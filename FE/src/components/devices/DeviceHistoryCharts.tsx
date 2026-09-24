"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { ApexOptions } from "apexcharts";
import flatpickr from "flatpickr";
import "flatpickr/dist/flatpickr.min.css";
import { api, ApiError } from "@/lib/api";
import type { DeviceHistory, HistoryBucket } from "@/types/device";
import { CalenderIcon } from "../../icons";
import { prepareSeries, insertGaps, autoRange, type Point } from "@/lib/telemetry";
import { deriveCellStats } from "@/lib/packMetrics";
import { ALERT_THRESHOLDS } from "@/lib/alertRules";

const ReactApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

const RANGE_TABS = [
  { label: "6 Jam", hours: 6 },
  { label: "24 Jam", hours: 24 },
  { label: "7 Hari", hours: 24 * 7 },
];

const OV = ALERT_THRESHOLDS.cellOverVoltage; // 3.65
const UV = ALERT_THRESHOLDS.cellUnderVoltage; // 2.50

const voltageAnnotations: ApexOptions["annotations"] = {
  yaxis: [
    { y: UV, borderColor: "#f04438", strokeDashArray: 4, label: { text: `UV ${UV}V`, style: { color: "#fff", background: "#f04438", fontSize: "10px" } } },
    { y: OV, borderColor: "#f79009", strokeDashArray: 4, label: { text: `OV ${OV}V`, style: { color: "#fff", background: "#f79009", fontSize: "10px" } } },
  ],
};

const baseChartOptions: ApexOptions = {
  chart: {
    fontFamily: "Outfit, sans-serif",
    toolbar: { show: true, tools: { zoom: true, zoomin: true, zoomout: true, pan: true, reset: true, download: false } },
    zoom: { enabled: true, type: "x" },
    animations: { enabled: false },
  },
  stroke: { curve: "straight", width: 2 },
  dataLabels: { enabled: false },
  markers: { size: 0, hover: { size: 4 } },
  grid: { borderColor: "#e5e7eb", xaxis: { lines: { show: false } }, yaxis: { lines: { show: true } } },
  xaxis: {
    type: "datetime",
    labels: { datetimeUTC: false, style: { colors: "#6b7280", fontSize: "11px" } },
    axisBorder: { show: false },
    axisTicks: { show: false },
  },
  tooltip: { shared: true, intersect: false, x: { format: "dd MMM yyyy, HH:mm" } },
  legend: { position: "bottom", horizontalAlign: "center", fontSize: "12px", markers: { size: 5, shape: "square" } },
};

// Band cellMin–cellMax dgn gap (null) saat bucket kosong.
function buildBand(buckets: HistoryBucket[], gapMs: number): { x: number; y: [number, number] | null }[] {
  const sorted = buckets
    .filter((b) => b.cellMin != null && b.cellMax != null)
    .map((b) => ({ x: new Date(b.t).getTime(), y: [b.cellMin as number, b.cellMax as number] as [number, number] }))
    .sort((a, b) => a.x - b.x);
  const out: { x: number; y: [number, number] | null }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i].x - sorted[i - 1].x > gapMs) {
      out.push({ x: sorted[i - 1].x + gapMs / 2, y: null });
    }
    out.push(sorted[i]);
  }
  return out;
}

function lineFrom(buckets: HistoryBucket[], key: keyof HistoryBucket, gapMs: number): Point[] {
  return prepareSeries(
    buckets
      .filter((b) => b[key] != null)
      .map((b) => ({ x: new Date(b.t).getTime(), y: b[key] as number })),
    500,
    gapMs,
  );
}

export default function DeviceHistoryCharts({ deviceId }: { deviceId: string }) {
  const [history, setHistory] = useState<DeviceHistory | null>(null);
  const [hours, setHours] = useState(24);
  const [selectedPackIndex, setSelectedPackIndex] = useState<number | null>(null);
  const [voltageView, setVoltageView] = useState<"envelope" | "percell">("envelope");
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
        const data = await api.get<DeviceHistory>(`/devices/${deviceId}/history?hours=${hours}&bucket=auto&cells=1`);
        if (cancelled) return;
        setHistory(data);
        setSelectedPackIndex((prev) =>
          prev != null && data.packs.some((p) => p.index === prev) ? prev : (data.packs[0]?.index ?? null),
        );
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Gagal memuat riwayat data.");
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
  const bucketSeconds = history?.bucketSeconds ?? 120;
  const gapMs = bucketSeconds * 1000 * 2;
  const buckets = selectedPack?.buckets ?? [];

  // Statistik ringkasan dari snapshot terbaru (bucket terakhir tiap cell) via deriveCellStats.
  const latestSnapshotCells = (selectedPack?.cells ?? [])
    .map((cell) => {
      const last = cell.points[cell.points.length - 1];
      return last ? { index: cell.index, voltage: last.vAvg } : null;
    })
    .filter((c): c is { index: number; voltage: number } => c != null);
  const snapshotStats = deriveCellStats(latestSnapshotCells);
  const maxVoltage = snapshotStats.max != null ? snapshotStats.max.toFixed(3) : "—";
  const minVoltage = snapshotStats.min != null ? snapshotStats.min.toFixed(3) : "—";
  const voltageDelta = snapshotStats.deltaMv != null ? String(snapshotStats.deltaMv) : "—";

  // Auto-zoom Y voltage di sekitar data (min & max cell).
  const allVoltages = buckets.flatMap((b) => [b.cellMin, b.cellMax].filter((v): v is number => v != null));
  const voltageRange = autoRange(allVoltages, { step: 0.05, padding: 0.08, fallbackMin: 3.0, fallbackMax: 3.7 });

  const band = buildBand(buckets, gapMs);
  const avgLine = lineFrom(buckets, "cellAvg", gapMs);
  const deltaLine = lineFrom(buckets, "deltaMv", gapMs);

  const perCellSeries = (selectedPack?.cells ?? []).map((cell) => ({
    name: `Cell ${cell.index}`,
    type: "line" as const,
    data: prepareSeries(cell.points.map((p) => ({ x: new Date(p.t).getTime(), y: p.vAvg })), 500, gapMs),
  }));

  const temperatureSeries = (history?.packs ?? []).map((pack) => ({
    name: `Pack #${pack.index}`,
    data: lineFrom(pack.buckets, "tempAvg", gapMs),
  }));

  const powerLine = lineFrom(buckets, "powerAvg", gapMs);
  const currentLine = lineFrom(buckets, "currentAvg", gapMs);
  const hasPower = powerLine.some((p) => p.y != null) || currentLine.some((p) => p.y != null);

  const hasData = (history?.packs.length ?? 0) > 0;

  // --- Opsi chart voltage (envelope) ---
  const envelopeSeries = [
    { name: "Rentang cell (min–max)", type: "rangeArea", data: band },
    { name: "Rata-rata cell", type: "line", data: avgLine },
    { name: "Delta (mV)", type: "line", data: deltaLine },
  ];
  const envelopeOptions: ApexOptions = {
    ...baseChartOptions,
    chart: { ...baseChartOptions.chart, type: "rangeArea" },
    colors: ["#2563eb", "#465fff", "#f59e0b"],
    fill: { opacity: [0.24, 1, 1] },
    stroke: { curve: "straight", width: [0, 2, 2] },
    forecastDataPoints: { count: 0 },
    annotations: voltageAnnotations,
    yaxis: [
      { seriesName: "Rentang cell (min–max)", min: voltageRange.min, max: voltageRange.max, labels: { formatter: (v: number) => `${v.toFixed(3)}V` }, title: { text: "Voltage (V)" } },
      { seriesName: "Rata-rata cell", show: false, min: voltageRange.min, max: voltageRange.max },
      { seriesName: "Delta (mV)", opposite: true, min: 0, labels: { formatter: (v: number) => `${v.toFixed(0)}mV` }, title: { text: "Delta (mV)" } },
    ],
  };

  const perCellOptions: ApexOptions = {
    ...baseChartOptions,
    yaxis: { min: voltageRange.min, max: voltageRange.max, labels: { formatter: (v: number) => `${v.toFixed(3)}V` } },
    annotations: voltageAnnotations,
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-center border-b border-gray-100 dark:border-gray-800 pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-brand-500" />
              <h3 className="text-lg font-bold text-gray-800 dark:text-white/90">BMS Analytics &amp; Telemetry History</h3>
            </div>
            <p className="mt-1 text-gray-500 text-theme-sm dark:text-gray-400">
              Envelope tegangan cell, tren suhu &amp; daya. Agregasi {bucketSeconds >= 60 ? `${bucketSeconds / 60}m` : `${bucketSeconds}s`}/bucket.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-0.5 rounded-lg bg-gray-100 p-1 dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
              {RANGE_TABS.map((opt) => (
                <button
                  key={opt.hours}
                  type="button"
                  onClick={() => setHours(opt.hours)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                    hours === opt.hours ? "shadow-sm bg-white text-gray-900 dark:bg-gray-800 dark:text-white" : "text-gray-500 dark:text-gray-400 hover:text-gray-800"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="relative inline-flex items-center w-full sm:w-auto">
              <CalenderIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 pointer-events-none z-10" />
              <input
                ref={datePickerRef}
                className="h-10 pl-9 pr-4 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-700 outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 cursor-pointer shadow-sm w-full sm:w-[230px]"
                placeholder="Pilih tanggal"
              />
            </div>
          </div>
        </div>

        {!isLoading && !error && hasData && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 my-5">
            <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-800">
              <span className="text-xs text-gray-500 dark:text-gray-400 block">Max Cell Voltage</span>
              <span className="text-base font-bold text-gray-800 dark:text-white tabular-nums">{maxVoltage} V</span>
            </div>
            <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-800">
              <span className="text-xs text-gray-500 dark:text-gray-400 block">Min Cell Voltage</span>
              <span className="text-base font-bold text-gray-800 dark:text-white tabular-nums">{minVoltage} V</span>
            </div>
            <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-800">
              <span className="text-xs text-gray-500 dark:text-gray-400 block">Cell Delta (Imbalance)</span>
              <span className="text-base font-bold text-amber-600 dark:text-amber-400 tabular-nums">{voltageDelta} mV</span>
            </div>
            <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-800">
              <span className="text-xs text-gray-500 dark:text-gray-400 block">Active Pack Monitored</span>
              <span className="text-base font-bold text-brand-600 dark:text-brand-400 tabular-nums">Pack #{selectedPackIndex ?? "—"}</span>
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
            {/* VOLTAGE: envelope / per-cell */}
            <div className="p-4 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/20">
              <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
                <h4 className="text-sm font-bold text-gray-700 dark:text-white/90">Cell Voltage Envelope</h4>
                <div className="flex items-center gap-2 flex-wrap">
                  {history!.packs.length > 1 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {history!.packs.map((pack) => (
                        <button
                          key={pack.index}
                          type="button"
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
                  <div className="flex items-center gap-0.5 rounded-lg bg-gray-100 p-1 dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
                    {(["envelope", "percell"] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setVoltageView(v)}
                        aria-pressed={voltageView === v}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                          voltageView === v ? "bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-white" : "text-gray-500 dark:text-gray-400 hover:text-gray-800"
                        }`}
                      >
                        {v === "envelope" ? "Envelope" : "Per-cell"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="max-w-full overflow-x-auto custom-scrollbar">
                <div className="min-w-[700px]">
                  {voltageView === "envelope" ? (
                    <ReactApexChart options={envelopeOptions} series={envelopeSeries} type="rangeArea" height={320} />
                  ) : (
                    <ReactApexChart options={perCellOptions} series={perCellSeries} type="line" height={320} />
                  )}
                </div>
              </div>
            </div>

            {/* TEMPERATURE */}
            <div className="p-4 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/20">
              <h4 className="text-sm font-bold text-gray-700 dark:text-white/90 mb-3">Temperature Trend per Pack</h4>
              <div className="max-w-full overflow-x-auto custom-scrollbar">
                <div className="min-w-[700px]">
                  <ReactApexChart
                    options={{ ...baseChartOptions, colors: ["#465fff", "#12b76a", "#f59e0b"], yaxis: { labels: { formatter: (v: number) => `${v.toFixed(1)}°C` } } }}
                    series={temperatureSeries}
                    type="area"
                    height={240}
                  />
                </div>
              </div>
            </div>

            {/* POWER & CURRENT */}
            <div className="p-4 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/20">
              <h4 className="text-sm font-bold text-gray-700 dark:text-white/90 mb-3">Daya &amp; Arus — Pack #{selectedPackIndex ?? "—"}</h4>
              {hasPower ? (
                <div className="max-w-full overflow-x-auto custom-scrollbar">
                  <div className="min-w-[700px]">
                    <ReactApexChart
                      options={{
                        ...baseChartOptions,
                        colors: ["#465fff", "#12b76a"],
                        stroke: { curve: "straight", width: [2, 2] },
                        yaxis: [
                          { seriesName: "Daya (W)", labels: { formatter: (v: number) => `${v.toFixed(0)}W` }, title: { text: "Daya (W)" } },
                          { seriesName: "Arus (A)", opposite: true, labels: { formatter: (v: number) => `${v.toFixed(2)}A` }, title: { text: "Arus (A)" } },
                        ],
                      }}
                      series={[
                        { name: "Daya (W)", type: "line", data: powerLine },
                        { name: "Arus (A)", type: "line", data: currentLine },
                      ]}
                      type="line"
                      height={240}
                    />
                  </div>
                </div>
              ) : (
                <p className="py-8 text-center text-sm text-gray-500">Data arus/daya belum tersedia untuk pack ini.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
