import { describe, expect, it } from "vitest";
import { encodeCursor } from "./cursor";
import { assertPointBudget, cellAggToSeries, mergeCellAgg, mergePackAgg, packAggToSeries, packRawToSeries, resolveHistoryParams, MAX_POINTS } from "./history";

const now = new Date("2026-09-21T12:00:00.000Z");
const base = { bucket: "5m" as const };
const code = (fn: () => unknown) => {
  try { fn(); return null; } catch (e) { return (e as { code?: string; details?: { path: string; message: string }[] }); }
};

describe("resolveHistoryParams", () => {
  it("default: 24 jam terakhir, bucket 5m, metrics pack-level", () => {
    const p = resolveHistoryParams(base, now);
    expect(p.to).toEqual(now);
    expect(p.from.toISOString()).toBe("2026-09-20T12:00:00.000Z");
    expect(p.metrics).toEqual(["temperature", "current", "power"]);
    expect(p.packIndex).toBeNull();
    expect(p.limit).toBe(1000);
  });
  it("from >= to ditolak; tanggal ngawur ditolak dengan path", () => {
    expect(code(() => resolveHistoryParams({ ...base, from: "2026-09-21T13:00:00Z" }, now))?.code).toBe("VALIDATION_ERROR");
    const e = code(() => resolveHistoryParams({ ...base, from: "besok" }, now));
    expect(e?.details?.[0].path).toBe("from");
  });
  it("metrics: csv, dedupe, tak dikenal ditolak, kosong ditolak", () => {
    expect(resolveHistoryParams({ ...base, metrics: "power, voltage,power" }, now).metrics).toEqual(["power", "voltage"]);
    expect(code(() => resolveHistoryParams({ ...base, metrics: "soc" }, now))?.details?.[0].path).toBe("metrics");
    expect(code(() => resolveHistoryParams({ ...base, metrics: " , " }, now))?.code).toBe("VALIDATION_ERROR");
  });
  it("raw: rentang maks 48 jam dan tidak boleh mencampur voltage dengan metrik pack", () => {
    expect(code(() => resolveHistoryParams({ bucket: "raw", from: "2026-09-18T00:00:00Z" }, now))?.details?.[0].path).toBe("bucket");
    expect(code(() => resolveHistoryParams({ bucket: "raw", metrics: "voltage,power" }, now))?.details?.[0].path).toBe("metrics");
    expect(resolveHistoryParams({ bucket: "raw", metrics: "voltage" }, now).bucket).toBe("raw");
  });
  it("cursor raw valid dipulihkan; rusak -> INVALID_CURSOR", () => {
    const c = encodeCursor({ t: "2026-09-21T10:00:00.000Z", p: 1, c: null });
    const p = resolveHistoryParams({ bucket: "raw", cursor: c }, now);
    expect(p.cursor?.p).toBe(1);
    expect(code(() => resolveHistoryParams({ bucket: "raw", cursor: "ngawur" }, now))?.code).toBe("INVALID_CURSOR");
  });
});

describe("assertPointBudget", () => {
  const p = (bucket: "1m" | "5m" | "1h", hours: number, metrics = "power") =>
    resolveHistoryParams({ bucket, from: new Date(now.getTime() - hours * 3600_000).toISOString(), metrics }, now);
  it("dalam batas lolos", () => expect(() => assertPointBudget(p("5m", 24), 2, 0)).not.toThrow());
  it("melebihi batas -> 400 dengan saran bucket berikutnya", () => {
    const e = code(() => assertPointBudget(p("1m", 24 * 30), 2, 0));
    expect(e).toBeTruthy();
    expect(e!.details![0].message).toContain("bucket=5m");
    expect(e!.details![0].message).toContain(String(MAX_POINTS));
  });
  it("voltage dihitung per cell", () => {
    expect(code(() => assertPointBudget(p("1m", 24, "voltage"), 1, 48))).toBeTruthy(); // 1440*48 = 69k
    expect(() => assertPointBudget(p("1h", 24, "voltage"), 1, 48)).not.toThrow();
  });
  it("raw tidak memakai anggaran titik (dipaginasi)", () => {
    expect(() => assertPointBudget(resolveHistoryParams({ bucket: "raw" }, now), 100, 1000)).not.toThrow();
  });
});

describe("baris -> seri", () => {
  const t = (s: string) => new Date(`2026-09-21T${s}Z`);
  it("agregat: seri per pack per metrik, terurut, satuan benar, titik null dibuang", () => {
    const s = packAggToSeries(
      [
        { packIndex: 1, t: t("10:05:00"), tempAvg: null, tempMin: null, tempMax: null, tempN: 0, curAvg: 1, curMin: 0.5, curMax: 2, curN: 1, powAvg: 10, powMin: 5, powMax: 15, powN: 1 },
        { packIndex: 0, t: t("10:05:00"), tempAvg: 25.123456, tempMin: 25, tempMax: 26, tempN: 1, curAvg: -1, curMin: -2, curMax: 0, curN: 1, powAvg: -50, powMin: -60, powMax: -40, powN: 1 },
        { packIndex: 0, t: t("10:00:00"), tempAvg: 24, tempMin: 23, tempMax: 25, tempN: 1, curAvg: null, curMin: null, curMax: null, curN: 0, powAvg: -40, powMin: -41, powMax: -39, powN: 1 },
      ],
      ["temperature", "current", "power"],
    );
    expect(s.map((x) => `${x.packIndex}:${x.metric}:${x.unit}`)).toEqual(["0:temperature:C", "0:current:A", "0:power:W", "1:current:A", "1:power:W"]);
    const temp = s[0];
    expect(temp.points.map((x) => x.t)).toEqual(["2026-09-21T10:00:00.000Z", "2026-09-21T10:05:00.000Z"]);
    expect(temp.points[1]).toEqual({ t: "2026-09-21T10:05:00.000Z", v: 25.1235, min: 25, max: 26 });
    expect(s[1].points).toHaveLength(1); // arus 10:00 null dibuang
  });
  it("raw: min/max null; metrik yang tidak diminta tidak muncul", () => {
    const s = packRawToSeries([{ packIndex: 0, t: t("10:00:00"), temperature: 25, current: -1, power: -50 }], ["power"]);
    expect(s).toHaveLength(1);
    expect(s[0].points[0]).toEqual({ t: "2026-09-21T10:00:00.000Z", v: -50, min: null, max: null });
  });
  it("cell: seri per (pack, cell), scope cell, satuan V", () => {
    const s = cellAggToSeries([
      { packIndex: 0, cellIndex: 1, t: t("10:00:00"), avg: 3.31, min: 3.3, max: 3.32, n: 1 },
      { packIndex: 0, cellIndex: 0, t: t("10:00:00"), avg: 3.29, min: 3.29, max: 3.29, n: 1 },
    ]);
    expect(s.map((x) => [x.scope, x.cellIndex, x.unit])).toEqual([["cell", 0, "V"], ["cell", 1, "V"]]);
  });
});

describe("merge bucket lintas batas rollup/raw", () => {
  const t = new Date("2026-09-21T10:00:00Z");
  const row = (o: Partial<Parameters<typeof mergePackAgg>[0][0]>) => ({
    packIndex: 0, t, tempAvg: null, tempMin: null, tempMax: null, tempN: 0, curAvg: null, curMin: null, curMax: null, curN: 0, powAvg: null, powMin: null, powMax: null, powN: 0, ...o,
  });
  it("rata-rata berbobot eksak, min/max gabungan, count dijumlah", () => {
    // 3 sampel rata-rata 10 (rollup) + 1 sampel bernilai 30 (raw) -> (30+30)/4 = 15
    const [m] = mergePackAgg([
      row({ powAvg: 10, powMin: 8, powMax: 12, powN: 3 }),
      row({ powAvg: 30, powMin: 30, powMax: 30, powN: 1 }),
    ]);
    expect(m.powAvg).toBe(15);
    expect(m.powMin).toBe(8);
    expect(m.powMax).toBe(30);
    expect(m.powN).toBe(4);
  });
  it("bucket berbeda tidak digabung; metrik null di satu sisi memakai sisi lain", () => {
    const out = mergePackAgg([row({ tempAvg: 20, tempMin: 20, tempMax: 20, tempN: 2 }), row({ t: new Date(t.getTime() + 300_000), tempAvg: 22, tempMin: 22, tempMax: 22, tempN: 1 }), row({ tempAvg: null })]);
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.t.getTime() === t.getTime())?.tempAvg).toBe(20);
  });
  it("cell: berbobot", () => {
    const [m] = mergeCellAgg([
      { packIndex: 0, cellIndex: 2, t, avg: 3.3, min: 3.29, max: 3.31, n: 9 },
      { packIndex: 0, cellIndex: 2, t, avg: 3.4, min: 3.4, max: 3.4, n: 1 },
    ]);
    expect(m.avg).toBeCloseTo(3.31, 10);
    expect(m.min).toBe(3.29);
    expect(m.max).toBe(3.4);
    expect(m.n).toBe(10);
  });
});

import { boundaryFor } from "./history-store";

describe("boundaryFor (batas rollup/raw)", () => {
  const n = new Date("2026-09-21T12:00:00Z");
  const at = (iso: string) => new Date(iso);
  it("tanpa rollup: semua dari raw (boundary = from)", () => {
    expect(boundaryFor(null, at("2026-09-20T00:00:00Z"), n, n).toISOString()).toBe("2026-09-20T00:00:00.000Z");
  });
  it("seluruh rentang lebih tua dari 30 hari: boundary = akhir menit yang memuat `to` (menit terakhir tetap dari rollup)", () => {
    const from = at("2026-08-12T12:00:00Z"), to = at("2026-08-12T13:59:00Z");
    const covered = at("2026-09-21T11:58:00Z");
    expect(boundaryFor(covered, from, to, n).toISOString()).toBe("2026-08-12T14:00:00.000Z");
  });
  it("rentang melintasi cutoff: boundary = cutoff dibulatkan ke menit", () => {
    const from = at("2026-08-20T00:00:00Z"), to = n;
    expect(boundaryFor(at("2026-09-21T11:58:00Z"), from, to, n, 30).toISOString()).toBe("2026-08-22T12:00:00.000Z");
  });
  it("rollup tertinggal (covered < cutoff): boundary mengikuti covered", () => {
    const b = boundaryFor(at("2026-08-01T00:10:00Z"), at("2026-07-30T00:00:00Z"), n, n, 30);
    expect(b.toISOString()).toBe("2026-08-01T00:10:00.000Z");
  });
  it("boundary tidak pernah lebih awal dari from", () => {
    expect(boundaryFor(at("2026-01-01T00:00:00Z"), at("2026-09-20T00:00:00Z"), n, n).toISOString()).toBe("2026-09-20T00:00:00.000Z");
  });
});
