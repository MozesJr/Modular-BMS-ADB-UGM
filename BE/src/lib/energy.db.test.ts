import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Integrasi DB sekali-pakai: energi hari ini (lib/energy.ts). Lihat ingest.db.test.ts untuk
// pengaman URL (TEST_DATABASE_URL harus 127.0.0.1/localhost dan DB bernama bms_test*).
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

// NOW dipilih supaya batas 00:00 WIB (UTC+7, tanpa DST) diketahui persis: NOW dalam JKT = NOW+7h
// = 2026-09-21T17:00 (masih tanggal 21) -> truncate ke 2026-09-21T00:00 JKT -> minus 7h ->
// sinceUtc = 2026-09-20T17:00:00.000Z.
const NOW = new Date("2026-09-21T10:00:00.000Z");
const SINCE_UTC = new Date("2026-09-20T17:00:00.000Z");
const S = 1000;

d("energi hari ini / batas 00:00 WIB (DB nyata sekali-pakai)", () => {
  let prisma: typeof import("@/lib/prisma").prisma;
  let energy: typeof import("./energy");

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    ({ prisma } = await import("@/lib/prisma"));
    energy = await import("./energy");
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("sinceUtc dihitung SQL, sama dengan batas 00:00 WIB yang diharapkan", async () => {
    const dev = await prisma.device.create({ data: { serialNumber: `NRG-EMPTY-${Date.now()}` } });
    const res = await energy.computeEnergyToday([dev.id], { now: NOW });
    expect(res.sinceUtc).toBe(SINCE_UTC.toISOString());
    expect(res.byDevice.size).toBe(0); // tidak ada PackHistory -> tidak muncul di map
  });

  it("segmen yang melintasi 00:00 WIB DIPOTONG: hanya porsi setelah batas yang dihitung", async () => {
    const dev = await prisma.device.create({ data: { serialNumber: `NRG-CROSS-${Date.now()}` } });
    // dt penuh = 15s (<= gap 20s, bukan gap). Power konstan -80W (charging) supaya interpolasi
    // trivial: kontribusi setelah potong = 80 * 10s / 3600 = 800/3600 Wh (charge).
    await prisma.packHistory.createMany({
      data: [
        { deviceId: dev.id, packIndex: 0, recordedAt: new Date(SINCE_UTC.getTime() - 5 * S), power: -80, balancerConnected: true },
        { deviceId: dev.id, packIndex: 0, recordedAt: new Date(SINCE_UTC.getTime() + 10 * S), power: -80, balancerConnected: true },
      ],
    });
    const res = await energy.computeEnergyToday([dev.id], { now: NOW });
    const d0 = res.byDevice.get(dev.id)!;
    expect(d0).toBeDefined();
    expect(d0.energyInWh).toBeCloseTo(800 / 3600, 5);
    expect(d0.energyOutWh).toBeCloseTo(0, 5);
  });

  it("gap (> 2x interval sampling) TETAP di-drop walau segmen melintasi batas", async () => {
    const dev = await prisma.device.create({ data: { serialNumber: `NRG-GAP-${Date.now()}` } });
    // dt penuh = 25s (> gap 20s) -> harus 0 meski melintasi batas dan power besar.
    await prisma.packHistory.createMany({
      data: [
        { deviceId: dev.id, packIndex: 0, recordedAt: new Date(SINCE_UTC.getTime() - 15 * S), power: -500, balancerConnected: true },
        { deviceId: dev.id, packIndex: 0, recordedAt: new Date(SINCE_UTC.getTime() + 10 * S), power: -500, balancerConnected: true },
      ],
    });
    const res = await energy.computeEnergyToday([dev.id], { now: NOW });
    // Tidak ada kontribusi non-zero -> device tidak SUM apa pun -> tidak muncul di GROUP BY (0 baris).
    const d0 = res.byDevice.get(dev.id);
    expect(d0 == null || (d0.energyInWh === 0 && d0.energyOutWh === 0)).toBe(true);
  });

  it("charge vs discharge dipisah dengan benar (dua pack independen, seluruhnya setelah batas)", async () => {
    const dev = await prisma.device.create({ data: { serialNumber: `NRG-DIR-${Date.now()}` } });
    await prisma.packHistory.createMany({
      data: [
        // pack 0: charging konstan -40W selama 10s -> in = 40*10/3600
        { deviceId: dev.id, packIndex: 0, recordedAt: new Date(SINCE_UTC.getTime() + 10 * S), power: -40, balancerConnected: true },
        { deviceId: dev.id, packIndex: 0, recordedAt: new Date(SINCE_UTC.getTime() + 20 * S), power: -40, balancerConnected: true },
        // pack 1: discharging konstan +60W selama 10s -> out = 60*10/3600
        { deviceId: dev.id, packIndex: 1, recordedAt: new Date(SINCE_UTC.getTime() + 10 * S), power: 60, balancerConnected: true },
        { deviceId: dev.id, packIndex: 1, recordedAt: new Date(SINCE_UTC.getTime() + 20 * S), power: 60, balancerConnected: true },
      ],
    });
    const res = await energy.computeEnergyToday([dev.id], { now: NOW });
    const d0 = res.byDevice.get(dev.id)!;
    expect(d0.energyInWh).toBeCloseTo(400 / 3600, 5);
    expect(d0.energyOutWh).toBeCloseTo(600 / 3600, 5);
  });

  it("filter deviceIds: device lain tidak ikut ke-query walau ada data di rentang yang sama", async () => {
    const devA = await prisma.device.create({ data: { serialNumber: `NRG-A-${Date.now()}` } });
    const devB = await prisma.device.create({ data: { serialNumber: `NRG-B-${Date.now()}` } });
    await prisma.packHistory.createMany({
      data: [
        { deviceId: devA.id, packIndex: 0, recordedAt: new Date(SINCE_UTC.getTime() + 10 * S), power: -10, balancerConnected: true },
        { deviceId: devA.id, packIndex: 0, recordedAt: new Date(SINCE_UTC.getTime() + 20 * S), power: -10, balancerConnected: true },
        { deviceId: devB.id, packIndex: 0, recordedAt: new Date(SINCE_UTC.getTime() + 10 * S), power: -999, balancerConnected: true },
        { deviceId: devB.id, packIndex: 0, recordedAt: new Date(SINCE_UTC.getTime() + 20 * S), power: -999, balancerConnected: true },
      ],
    });
    const res = await energy.computeEnergyToday([devA.id], { now: NOW });
    expect(res.byDevice.has(devB.id)).toBe(false);
    expect(res.byDevice.get(devA.id)!.energyInWh).toBeCloseTo(100 / 3600, 5);
  });
});
