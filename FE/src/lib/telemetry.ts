// Utilitas seri waktu untuk chart history: sisip gap saat device offline + downsample
// (semua di sisi FE; backend belum menyediakan agregasi — lihat proposal Fase B).
import { SAMPLING_INTERVAL_MS } from "@/lib/freshness";

// Gap dianggap "putus" jika jarak antar dua titik > 2x interval sampling (dikonfirmasi ~10s).
export const GAP_THRESHOLD_MS = 2 * SAMPLING_INTERVAL_MS;

export type Point = { x: number; y: number | null };

// Sisipkan satu titik null di antara dua sampel yang jaraknya melebihi threshold,
// supaya ApexCharts memutus garis alih-alih menariknya melintasi periode offline.
export function insertGaps(points: Point[], gapMs: number = GAP_THRESHOLD_MS): Point[] {
  if (points.length < 2) return points;
  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    if (i > 0) {
      const prev = points[i - 1];
      if (curr.x - prev.x > gapMs) {
        // Titik null tepat setelah sampel sebelumnya → garis berhenti di sini.
        out.push({ x: prev.x + gapMs / 2, y: null });
      }
    }
    out.push(curr);
  }
  return out;
}

// Largest-Triangle-Three-Buckets: pertahankan bentuk visual seri sambil mengurangi jumlah titik.
// Hanya beroperasi pada titik non-null; caller memanggil insertGaps SETELAH downsample.
export function lttbDownsample(
  data: { x: number; y: number }[],
  threshold: number,
): { x: number; y: number }[] {
  const n = data.length;
  if (threshold >= n || threshold < 3) return data;

  const sampled: { x: number; y: number }[] = [];
  const bucketSize = (n - 2) / (threshold - 2);

  let a = 0; // titik pertama selalu dipertahankan
  sampled.push(data[a]);

  for (let i = 0; i < threshold - 2; i++) {
    // Rata-rata bucket berikutnya (untuk membentuk segitiga terbesar).
    const avgRangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const avgRangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, n);
    const avgRangeLen = avgRangeEnd - avgRangeStart;
    let avgX = 0;
    let avgY = 0;
    for (let j = avgRangeStart; j < avgRangeEnd; j++) {
      avgX += data[j].x;
      avgY += data[j].y;
    }
    if (avgRangeLen > 0) {
      avgX /= avgRangeLen;
      avgY /= avgRangeLen;
    }

    const rangeStart = Math.floor(i * bucketSize) + 1;
    const rangeEnd = Math.floor((i + 1) * bucketSize) + 1;
    const pointAX = data[a].x;
    const pointAY = data[a].y;

    let maxArea = -1;
    let nextA = rangeStart;
    for (let j = rangeStart; j < rangeEnd; j++) {
      const area =
        Math.abs(
          (pointAX - avgX) * (data[j].y - pointAY) -
            (pointAX - data[j].x) * (avgY - pointAY),
        ) * 0.5;
      if (area > maxArea) {
        maxArea = area;
        nextA = j;
      }
    }
    sampled.push(data[nextA]);
    a = nextA;
  }

  sampled.push(data[n - 1]); // titik terakhir selalu dipertahankan
  return sampled;
}

// Pipeline lengkap: downsample titik valid lalu sisip gap. Input boleh mengandung y null.
export function prepareSeries(
  points: { x: number; y: number }[],
  maxPoints: number = 500,
  gapMs: number = GAP_THRESHOLD_MS,
): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const reduced = lttbDownsample(sorted, maxPoints);
  return insertGaps(reduced, gapMs);
}

// Rentang Y auto-zoom di sekitar data dengan padding, dibulatkan ke kelipatan `step`.
// Fallback ke [fallbackMin, fallbackMax] jika tidak ada data.
export function autoRange(
  values: number[],
  opts: { padding?: number; step?: number; fallbackMin: number; fallbackMax: number },
): { min: number; max: number } {
  const { padding = 0.05, step = 0.05, fallbackMin, fallbackMax } = opts;
  if (values.length === 0) return { min: fallbackMin, max: fallbackMax };
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (lo === hi) {
    return { min: lo - step, max: hi + step };
  }
  const pad = (hi - lo) * padding;
  const min = Math.floor((lo - pad) / step) * step;
  const max = Math.ceil((hi + pad) / step) * step;
  return { min, max };
}
