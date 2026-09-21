import { z } from "zod";
import { ApiError } from "@/lib/http";
import { decodeCursor } from "@/lib/cursor";

// Logika MURNI endpoint riwayat: validasi parameter, batas titik, pemetaan baris -> seri. (SQL ada di history-store.ts)

export type Bucket = "raw" | "1m" | "5m" | "1h";
export type Metric = "temperature" | "current" | "power" | "voltage";

export const PACK_METRICS: Metric[] = ["temperature", "current", "power"];
export const DEFAULT_METRICS: Metric[] = ["temperature", "current", "power"];
export const MAX_POINTS = 20_000; // total titik semua seri pada bucket agregat
export const RAW_MAX_SPAN_MS = 48 * 3600_000;
export const DEFAULT_RAW_LIMIT = 1000;
export const RAW_RETENTION_DAYS_DEFAULT = 30;

const BUCKET_SEC: Record<Exclude<Bucket, "raw">, number> = { "1m": 60, "5m": 300, "1h": 3600 };
export const bucketSeconds = (b: Exclude<Bucket, "raw">) => BUCKET_SEC[b];

const UNIT: Record<Metric, "C" | "A" | "W" | "V"> = { temperature: "C", current: "A", power: "W", voltage: "V" };

export interface HistoryParams {
  from: Date;
  to: Date;
  bucket: Bucket;
  metrics: Metric[];
  packIndex: number | null;
  limit: number;
  cursor: { t: Date; p: number; c: number | null } | null;
}

const issue = (path: string, message: string) =>
  new ApiError(400, "VALIDATION_ERROR", message, [{ path, message }]);

const parseTime = (raw: string | undefined, path: string, fallback: Date): Date => {
  if (raw === undefined) return fallback;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime()) || !/^\d{4}-\d{2}-\d{2}/.test(raw)) throw issue(path, `${path} harus ISO-8601 (mis. 2026-09-21T08:00:00Z)`);
  return d;
};

const cursorSchema = z.object({ t: z.iso.datetime(), p: z.number().int(), c: z.number().int().nullable() });

export function resolveHistoryParams(
  q: { from?: string; to?: string; bucket: Bucket; metrics?: string; packIndex?: number; cursor?: string; limit?: number },
  now: Date,
): HistoryParams {
  const to = parseTime(q.to, "to", now);
  const from = parseTime(q.from, "from", new Date(to.getTime() - 24 * 3600_000));
  if (from >= to) throw issue("from", "from harus lebih awal dari to");

  let metrics: Metric[] = DEFAULT_METRICS;
  if (q.metrics !== undefined) {
    const parts = q.metrics.split(",").map((m) => m.trim()).filter(Boolean);
    if (parts.length === 0) throw issue("metrics", "metrics tidak boleh kosong");
    const valid: Metric[] = ["temperature", "current", "power", "voltage"];
    const bad = parts.find((m) => !valid.includes(m as Metric));
    if (bad) throw issue("metrics", `metric tidak dikenal: ${bad} (pilihan: ${valid.join(", ")})`);
    metrics = Array.from(new Set(parts)) as Metric[];
  }

  if (q.bucket === "raw") {
    if (to.getTime() - from.getTime() > RAW_MAX_SPAN_MS) {
      throw issue("bucket", "bucket=raw dibatasi rentang maksimal 48 jam; perkecil rentang atau pakai bucket 1m/5m/1h");
    }
    const hasVoltage = metrics.includes("voltage");
    const hasPack = metrics.some((m) => m !== "voltage");
    if (hasVoltage && hasPack) {
      throw issue("metrics", "bucket=raw: `voltage` (per cell) tidak boleh digabung dengan temperature/current/power; minta terpisah");
    }
  }

  const cur = q.cursor ? decodeCursor(q.cursor, cursorSchema) : null;
  return {
    from,
    to,
    bucket: q.bucket,
    metrics,
    packIndex: q.packIndex ?? null,
    limit: q.limit ?? DEFAULT_RAW_LIMIT,
    cursor: cur ? { t: new Date(cur.t), p: cur.p, c: cur.c } : null,
  };
}

// Perkiraan batas atas jumlah titik agregat = jumlah bucket × jumlah seri. Bila > MAX_POINTS -> 400 dengan saran.
export function assertPointBudget(p: HistoryParams, packCount: number, cellCount: number) {
  if (p.bucket === "raw") return;
  const sec = bucketSeconds(p.bucket);
  const buckets = Math.ceil((p.to.getTime() - p.from.getTime()) / 1000 / sec);
  const packSeries = p.metrics.filter((m) => m !== "voltage").length * packCount;
  const cellSeries = p.metrics.includes("voltage") ? cellCount : 0;
  const total = buckets * (packSeries + cellSeries);
  if (total > MAX_POINTS) {
    const order: Bucket[] = ["1m", "5m", "1h"];
    const next = order[order.indexOf(p.bucket) + 1];
    const hint = next ? `pakai bucket=${next}, ` : "";
    throw issue(
      "bucket",
      `Rentang terlalu besar (~${total} titik, batas ${MAX_POINTS}): ${hint}perpendek rentang from/to, atau batasi dengan packIndex/metrics`,
    );
  }
}

// ---------- baris -> seri ----------
export interface SeriesOut {
  scope: "pack" | "cell";
  packIndex: number;
  cellIndex: number | null;
  metric: Metric;
  unit: "C" | "A" | "W" | "V";
  points: { t: string; v: number; min: number | null; max: number | null }[];
}

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

export interface PackAggRow {
  packIndex: number;
  t: Date;
  tempAvg: number | null; tempMin: number | null; tempMax: number | null; tempN: number;
  curAvg: number | null; curMin: number | null; curMax: number | null; curN: number;
  powAvg: number | null; powMin: number | null; powMax: number | null; powN: number;
}
export interface PackRawRow { packIndex: number; t: Date; temperature: number | null; current: number | null; power: number | null }
export interface CellAggRow { packIndex: number; cellIndex: number; t: Date; avg: number; min: number; max: number; n: number }
export interface CellRawRow { packIndex: number; cellIndex: number; t: Date; voltage: number }

class SeriesBook {
  private map = new Map<string, SeriesOut>();
  add(scope: "pack" | "cell", packIndex: number, cellIndex: number | null, metric: Metric, t: Date, v: number | null, min: number | null, max: number | null) {
    if (v === null) return;
    const key = `${scope}|${packIndex}|${cellIndex ?? ""}|${metric}`;
    let s = this.map.get(key);
    if (!s) {
      s = { scope, packIndex, cellIndex, metric, unit: UNIT[metric], points: [] };
      this.map.set(key, s);
    }
    s.points.push({ t: t.toISOString(), v: r4(v), min: min === null ? null : r4(min), max: max === null ? null : r4(max) });
  }
  result(): SeriesOut[] {
    const order: Metric[] = ["temperature", "current", "power", "voltage"];
    return [...this.map.values()]
      .map((s) => ({ ...s, points: s.points.sort((a, b) => a.t.localeCompare(b.t)) }))
      .sort((a, b) => a.packIndex - b.packIndex || (a.cellIndex ?? -1) - (b.cellIndex ?? -1) || order.indexOf(a.metric) - order.indexOf(b.metric));
  }
}

export function packAggToSeries(rows: PackAggRow[], metrics: Metric[]): SeriesOut[] {
  const book = new SeriesBook();
  for (const r of rows) {
    if (metrics.includes("temperature")) book.add("pack", r.packIndex, null, "temperature", r.t, r.tempAvg, r.tempMin, r.tempMax);
    if (metrics.includes("current")) book.add("pack", r.packIndex, null, "current", r.t, r.curAvg, r.curMin, r.curMax);
    if (metrics.includes("power")) book.add("pack", r.packIndex, null, "power", r.t, r.powAvg, r.powMin, r.powMax);
  }
  return book.result();
}

export function packRawToSeries(rows: PackRawRow[], metrics: Metric[]): SeriesOut[] {
  const book = new SeriesBook();
  for (const r of rows) {
    if (metrics.includes("temperature")) book.add("pack", r.packIndex, null, "temperature", r.t, r.temperature, null, null);
    if (metrics.includes("current")) book.add("pack", r.packIndex, null, "current", r.t, r.current, null, null);
    if (metrics.includes("power")) book.add("pack", r.packIndex, null, "power", r.t, r.power, null, null);
  }
  return book.result();
}

export function cellAggToSeries(rows: CellAggRow[]): SeriesOut[] {
  const book = new SeriesBook();
  for (const r of rows) book.add("cell", r.packIndex, r.cellIndex, "voltage", r.t, r.avg, r.min, r.max);
  return book.result();
}

export function cellRawToSeries(rows: CellRawRow[]): SeriesOut[] {
  const book = new SeriesBook();
  for (const r of rows) book.add("cell", r.packIndex, r.cellIndex, "voltage", r.t, r.voltage, null, null);
  return book.result();
}

// ---------- penggabungan bucket yang melintasi batas rollup/raw ----------
// Bucket 5m/1h bisa berisi sebagian menit dari rollup dan sebagian dari raw. Gabungkan dengan rata-rata BERBOBOT (count),
// min/max eksak — tidak ada titik ganda dan tidak ada data yang hilang.
function mergeStat(a: { avg: number | null; min: number | null; max: number | null; n: number }, b: typeof a) {
  const n = a.n + b.n;
  const avg = a.avg === null ? b.avg : b.avg === null ? a.avg : (a.avg * a.n + b.avg * b.n) / n;
  const min = a.min === null ? b.min : b.min === null ? a.min : Math.min(a.min, b.min);
  const max = a.max === null ? b.max : b.max === null ? a.max : Math.max(a.max, b.max);
  return { avg, min, max, n };
}

export function mergePackAgg(rows: PackAggRow[]): PackAggRow[] {
  const map = new Map<string, PackAggRow>();
  for (const r of rows) {
    const key = `${r.packIndex}|${r.t.getTime()}`;
    const ex = map.get(key);
    if (!ex) {
      map.set(key, { ...r });
      continue;
    }
    const t = mergeStat({ avg: ex.tempAvg, min: ex.tempMin, max: ex.tempMax, n: ex.tempN }, { avg: r.tempAvg, min: r.tempMin, max: r.tempMax, n: r.tempN });
    const c = mergeStat({ avg: ex.curAvg, min: ex.curMin, max: ex.curMax, n: ex.curN }, { avg: r.curAvg, min: r.curMin, max: r.curMax, n: r.curN });
    const p = mergeStat({ avg: ex.powAvg, min: ex.powMin, max: ex.powMax, n: ex.powN }, { avg: r.powAvg, min: r.powMin, max: r.powMax, n: r.powN });
    Object.assign(ex, { tempAvg: t.avg, tempMin: t.min, tempMax: t.max, tempN: t.n, curAvg: c.avg, curMin: c.min, curMax: c.max, curN: c.n, powAvg: p.avg, powMin: p.min, powMax: p.max, powN: p.n });
  }
  return [...map.values()];
}

export function mergeCellAgg(rows: CellAggRow[]): CellAggRow[] {
  const map = new Map<string, CellAggRow>();
  for (const r of rows) {
    const key = `${r.packIndex}|${r.cellIndex}|${r.t.getTime()}`;
    const ex = map.get(key);
    if (!ex) {
      map.set(key, { ...r });
      continue;
    }
    const m = mergeStat({ avg: ex.avg, min: ex.min, max: ex.max, n: ex.n }, { avg: r.avg, min: r.min, max: r.max, n: r.n });
    Object.assign(ex, { avg: m.avg as number, min: m.min as number, max: m.max as number, n: m.n });
  }
  return [...map.values()];
}
