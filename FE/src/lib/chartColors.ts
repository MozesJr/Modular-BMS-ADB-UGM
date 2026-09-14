// Palette default bawaan ApexCharts (theme.palette "palette1") — dipakai project ini di semua
// chart multi-series tanpa `colors` custom. Diekspos di sini biar elemen non-chart (mis. sparkline,
// highlight) bisa ikut warna yang sama persis dengan legend chart Voltage per Cell.
export const APEXCHARTS_DEFAULT_PALETTE = [
  "#008FFB",
  "#00E396",
  "#FEB019",
  "#FF4560",
  "#775DD0",
] as const;

export function getSeriesColor(seriesPosition: number): string {
  return APEXCHARTS_DEFAULT_PALETTE[seriesPosition % APEXCHARTS_DEFAULT_PALETTE.length];
}
