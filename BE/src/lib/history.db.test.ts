import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";

// Integrasi DB sekali-pakai: riwayat (raw/agregat/rollup/retensi). Lihat ingest.db.test.ts untuk pengaman URL.
const url = process.env.TEST_DATABASE_URL;
const safe = (() => {
  if (!url) return false;
  try {
    const u = new URL(url);
    return ["127.0.0.1", "localhost"].includes(u.hostname) && u.pathname.startsWith("/bms_test");
  } catch {
    return false;
  }
})();
if (url && !safe) throw new Error("TEST_DATABASE_URL ditolak: harus 127.0.0.1/localhost dan DB bernama bms_test*");

const d = safe ? describe : describe.skip;
const NOW = new Date("2026-09-21T12:00:00.000Z");
const MIN = 60_000;
const DAY = 86_400_000;

d("riwayat + rollup + retensi (DB nyata sekali-pakai)", () => {
  let prisma: typeof import("@/lib/prisma").prisma;
  let store: typeof import("./history-store");
  let hist: typeof import("./history");
  let retention: typeof import("./retention");
  let deviceId = "";
  const winOld = new Date(NOW.getTime() - 40 * DAY); // di luar 30 hari
  const winMid = new Date(NOW.getTime() - 15 * DAY);
  const winRecent = new Date(NOW.getTime() - 200 * MIN);
  const winStraddle = new Date(NOW.getTime() - 30 * DAY - 30 * MIN); // melintasi batas cutoff 30 hari

  const at = (base: Date, k: number) => new Date(base.getTime() + k * MIN);

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    ({ prisma } = await import("@/lib/prisma"));
    store = await import("./history-store");
    hist = await import("./history");
    retention = await import("./retention");

    const dev = await prisma.device.create({ data: { serialNumber: `HIST-${Date.now()}` } });
    deviceId = dev.id;

    const packRows: Prisma.PackHistoryCreateManyInput[] = [];
    const cellRows: Prisma.CellHistoryCreateManyInput[] = [];
    for (const base of [winOld, winStraddle, winMid, winRecent]) {
      for (let k = 0; k < 120; k++) {
        const recordedAt = at(base, k);
        for (const packIndex of [0, 1]) {
          packRows.push({
            deviceId, packIndex, recordedAt,
            temperature: packIndex === 1 && k % 7 === 0 ? null : 20 + (k % 10), // sesekali null (sensor error)
            balancerConnected: true,
            current: packIndex === 0 ? -1 - (k % 3) : null,
            power: packIndex * 100 + k,
          });
        }
        for (const cellIndex of [0, 1, 2]) {
          cellRows.push({ deviceId, packIndex: 0, cellIndex, recordedAt, voltage: Math.round((3.3 + cellIndex * 0.01 + (k % 5) * 0.001) * 1e4) / 1e4 });
        }
      }
    }
    await prisma.packHistory.createMany({ data: packRows, skipDuplicates: true });
    await prisma.cellHistory.createMany({ data: cellRows, skipDuplicates: true });
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const params = (q: Record<string, unknown>) => hist.resolveHistoryParams({ bucket: "5m", ...q } as never, NOW);
  const run = (q: Record<string, unknown>) => store.loadHistory(deviceId, params(q), NOW);

  it("agregat 5m: rata-rata/min/max benar dan bucket kosong tidak muncul", async () => {
    // bucket 5m pertama winRecent: menit k=0..4 -> power pack0 = 0..4 (avg 2); pack1 = 100..104 (avg 102)
    const from = at(winRecent, 0).toISOString();
    const { series } = await run({ from, to: at(winRecent, 4).toISOString(), metrics: "power" });
    const p0 = series.find((s) => s.packIndex === 0)!;
    expect(p0.points).toHaveLength(1);
    expect(p0.points[0]).toMatchObject({ t: from, v: 2, min: 0, max: 4 });
    const p1 = series.find((s) => s.packIndex === 1)!;
    expect(p1.points[0]).toMatchObject({ v: 102, min: 100, max: 104 });
    expect(p0.unit).toBe("W");
  });

  it("suhu null tidak menjadi titik dan tidak merusak rata-rata; arus null seluruhnya -> tanpa seri", async () => {
    const from = at(winRecent, 0).toISOString();
    const { series } = await run({ from, to: at(winRecent, 13).toISOString(), bucket: "1h", metrics: "temperature,current" });
    expect(series.some((s) => s.packIndex === 1 && s.metric === "current")).toBe(false); // pack1 current selalu null
    const t1 = series.find((s) => s.packIndex === 1 && s.metric === "temperature")!;
    // pack1 k=0..13, null pada k=0,7 -> nilai (20+k%10) untuk k selain 0 dan 7
    const expected = [...Array(14).keys()].filter((k) => k % 7 !== 0).map((k) => 20 + (k % 10));
    expect(t1.points[0].v).toBeCloseTo(expected.reduce((a, b) => a + b, 0) / expected.length, 3);
  });

  it("cell voltage 1m: per (pack, cell), satuan V", async () => {
    const from = at(winRecent, 0).toISOString();
    const { series } = await run({ from, to: at(winRecent, 2).toISOString(), bucket: "1m", metrics: "voltage" });
    expect(series).toHaveLength(3);
    expect(series.every((s) => s.scope === "cell" && s.unit === "V" && s.points.length === 3)).toBe(true);
  });

  it("raw: keyset pagination lengkap, berurutan, tanpa duplikat/hilang walau dua pack berbagi waktu yang sama", async () => {
    const from = at(winRecent, 0).toISOString();
    const to = at(winRecent, 59).toISOString();
    const all: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const { series, nextCursor } = await run({ bucket: "raw", from, to, metrics: "power", limit: 7, cursor });
      pages++;
      for (const s of series) for (const pt of s.points) all.push(`${s.packIndex}@${pt.t}`);
      if (!nextCursor) break;
      cursor = nextCursor;
      expect(pages).toBeLessThan(100);
    }
    expect(all).toHaveLength(60 * 2); // 60 menit × 2 pack, tepat sekali
    expect(new Set(all).size).toBe(all.length);
    expect(pages).toBe(Math.ceil(120 / 7));
  });

  it("raw voltage: paginasi per (recordedAt, pack, cell)", async () => {
    const from = at(winRecent, 0).toISOString();
    const to = at(winRecent, 9).toISOString();
    let cursor: string | undefined;
    let total = 0;
    for (;;) {
      const { series, nextCursor } = await run({ bucket: "raw", from, to, metrics: "voltage", limit: 4, cursor });
      total += series.reduce((n, s) => n + s.points.length, 0);
      if (!nextCursor) break;
      cursor = nextCursor;
    }
    expect(total).toBe(10 * 3);
  });

  it("packIndex membatasi seri; hasil kosong untuk rentang tanpa data", async () => {
    const { series } = await run({ from: at(winRecent, 0).toISOString(), to: at(winRecent, 30).toISOString(), packIndex: 1, metrics: "power" });
    expect(series.every((s) => s.packIndex === 1)).toBe(true);
    const empty = await run({ from: new Date(NOW.getTime() - 100 * DAY).toISOString(), to: new Date(NOW.getTime() - 99 * DAY).toISOString() });
    expect(empty.series).toEqual([]);
  });

  it("RETENSI: dry-run tidak mengubah apa pun tapi melaporkan yang akan dilakukan", async () => {
    const before = await prisma.packHistory.count({ where: { deviceId } });
    const r = await retention.runRetention(prisma, { execute: false, now: NOW });
    expect(r.mode).toBe("dry-run");
    expect(r.pack.rawRowsAggregated).toBeGreaterThan(0);
    // winOld: 120 menit × 2 pack = 240; winStraddle: 30 menit pertama (sebelum cutoff 30 hari) × 2 pack = 60
    expect(r.pack.rawRowsDeleted).toBe(300);
    expect(await prisma.packHistory.count({ where: { deviceId } })).toBe(before);
    expect(await prisma.packRollup1m.count({ where: { deviceId } })).toBe(0);
  });

  it("RETENSI: query SEBELUM dan SESUDAH retensi identik (rollup+raw digabung == raw murni), termasuk bucket lintas batas", async () => {
    const ranges = [
      { from: winOld.toISOString(), to: at(winOld, 119).toISOString(), bucket: "1h" },
      { from: at(winStraddle, -60).toISOString(), to: at(winStraddle, 130).toISOString(), bucket: "5m" }, // melintasi cutoff 30 hari
      { from: at(winStraddle, -60).toISOString(), to: at(winStraddle, 130).toISOString(), bucket: "1h" },
      { from: new Date(NOW.getTime() - 41 * DAY).toISOString(), to: NOW.toISOString(), bucket: "1h", packIndex: 0 },
    ];
    const metricsSets = ["temperature,current,power", "voltage"];
    const snapshot = async () => {
      const out: unknown[] = [];
      for (const rg of ranges) for (const m of metricsSets) out.push((await run({ ...rg, metrics: m })).series);
      return out;
    };
    const before = await snapshot();
    expect(JSON.stringify(before).length).toBeGreaterThan(1000);

    const rawBefore = await prisma.packHistory.count({ where: { deviceId } });
    const rep = await retention.runRetention(prisma, { execute: true, now: NOW });
    expect(rep.mode).toBe("execute");
    expect(rep.pack.rollupRowsWritten).toBeGreaterThan(0);
    expect(rep.pack.rawRowsDeleted).toBeGreaterThan(0);
    const rawAfter = await prisma.packHistory.count({ where: { deviceId } });
    expect(rawAfter).toBe(rawBefore - rep.pack.rawRowsDeleted);
    // raw > 30 hari hilang, raw ≤ 30 hari utuh
    const cutoff = new Date(NOW.getTime() - 30 * DAY);
    expect(await prisma.packHistory.count({ where: { deviceId, recordedAt: { lt: new Date(Math.floor(cutoff.getTime() / MIN) * MIN) } } })).toBe(0);
    expect(await prisma.packHistory.count({ where: { deviceId, recordedAt: { gte: winMid, lt: at(winMid, 120) } } })).toBe(240);
    expect(await prisma.packHistory.count({ where: { deviceId, recordedAt: { gte: winRecent } } })).toBe(240);
    expect(await prisma.packRollup1m.count({ where: { deviceId } })).toBeGreaterThan(0);

    const after = await snapshot();
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) {
      const b = before[i] as { points: { t: string; v: number; min: number; max: number }[] }[];
      const a = after[i] as typeof b;
      expect(a.length, `range #${i} jumlah seri`).toBe(b.length);
      for (let s = 0; s < b.length; s++) {
        expect(a[s].points.length, `range #${i} seri ${s} jumlah titik`).toBe(b[s].points.length);
        b[s].points.forEach((pt, j) => {
          const ctx = `range #${i} seri ${s} (${JSON.stringify({ ...(after[i] as never as { packIndex: number; metric: string }[])[s] , points: undefined })}) titik ${j} t=${pt.t}`;
          expect(a[s].points[j].t, ctx).toBe(pt.t);
          expect(a[s].points[j].v, ctx).toBeCloseTo(pt.v, 3);
          expect(a[s].points[j].min, ctx).toBeCloseTo(pt.min, 3);
          expect(a[s].points[j].max, ctx).toBeCloseTo(pt.max, 3);
        });
      }
    }
  });

  it("RETENSI idempoten: run kedua tidak mengubah rollup dan tidak error", async () => {
    const before = await prisma.packRollup1m.count({ where: { deviceId } });
    const rep = await retention.runRetention(prisma, { execute: true, now: NOW });
    expect(rep.pack.rawRowsDeleted).toBe(0);
    expect(await prisma.packRollup1m.count({ where: { deviceId } })).toBe(before);
  });

  it("RETENSI aman: baris terlambat yang tua dan belum ter-rollup di-rollup DULU sebelum dihapus", async () => {
    const late = new Date(NOW.getTime() - 45 * DAY + 7 * 3600_000);
    await prisma.packHistory.create({ data: { deviceId, packIndex: 0, recordedAt: late, temperature: 33, balancerConnected: true, current: null, power: 555 } });
    const minuteStart = new Date(Math.floor(late.getTime() / MIN) * MIN);
    expect(await prisma.packRollup1m.count({ where: { deviceId, bucketStart: minuteStart } })).toBe(0);
    await retention.runRetention(prisma, { execute: true, now: NOW });
    expect(await prisma.packHistory.count({ where: { deviceId, recordedAt: late } })).toBe(0); // dihapus
    const roll = await prisma.packRollup1m.findFirst({ where: { deviceId, packIndex: 0, bucketStart: minuteStart } });
    expect(roll?.powerAvg).toBe(555); // tetapi tidak hilang: sudah ada di rollup
  });

  it("retensi membersihkan refresh token & reset token yang sudah lama tak berlaku, dan rollup > 365 hari", async () => {
    const u = await prisma.user.create({ data: { email: `ret${Date.now()}@test.local`, passwordHash: "x" } });
    const oldDate = new Date(NOW.getTime() - 40 * DAY);
    await prisma.refreshToken.create({ data: { userId: u.id, familyId: "f", tokenHash: `h-old-${Date.now()}`, tokenVersion: 0, expiresAt: oldDate, familyExpiresAt: oldDate } });
    await prisma.refreshToken.create({ data: { userId: u.id, familyId: "g", tokenHash: `h-new-${Date.now()}`, tokenVersion: 0, expiresAt: new Date(NOW.getTime() + DAY), familyExpiresAt: new Date(NOW.getTime() + DAY) } });
    await prisma.packRollup1m.create({ data: { deviceId, packIndex: 9, bucketStart: new Date(NOW.getTime() - 400 * DAY), samples: 1 } });
    const rep = await retention.runRetention(prisma, { execute: true, now: NOW });
    expect(rep.refreshTokensPruned).toBeGreaterThanOrEqual(1);
    expect(await prisma.refreshToken.count({ where: { userId: u.id } })).toBe(1); // yang masih berlaku tetap ada
    expect(await prisma.packRollup1m.count({ where: { deviceId, packIndex: 9 } })).toBe(0);
  });

  it("menghapus device menghapus rollup-nya (cascade)", async () => {
    const dev = await prisma.device.create({ data: { serialNumber: `CASC-${Date.now()}` } });
    await prisma.packRollup1m.create({ data: { deviceId: dev.id, packIndex: 0, bucketStart: NOW, samples: 1 } });
    await prisma.cellRollup1m.create({ data: { deviceId: dev.id, packIndex: 0, cellIndex: 0, bucketStart: NOW, samples: 1, vAvg: 3.3, vMin: 3.3, vMax: 3.3 } });
    await prisma.device.delete({ where: { id: dev.id } });
    expect(await prisma.packRollup1m.count({ where: { deviceId: dev.id } })).toBe(0);
    expect(await prisma.cellRollup1m.count({ where: { deviceId: dev.id } })).toBe(0);
  });
});
