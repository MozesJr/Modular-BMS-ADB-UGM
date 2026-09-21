import { describe, expect, it } from "vitest";
import { cellDeltaMv, deviceStats, isOnline, lastSeenAt, onlineThresholdSec, packVoltageV } from "./device-view";

const t = (s: string) => new Date(s);
const pack = (over: Record<string, unknown> = {}) => ({
  index: 0, temperature: 25, current: -1.5, power: -80, receivedAt: t("2026-09-21T10:00:00Z"), updatedAt: t("2026-09-21T09:59:00Z"),
  cells: [{ voltage: 3.3 }, { voltage: 3.32 }, { voltage: 3.31 }], ...over,
});

describe("device-view", () => {
  it("tegangan pack = jumlah cell (dibulatkan 3 desimal, tanpa noise float)", () => {
    expect(packVoltageV([{ voltage: 3.3 }, { voltage: 3.32 }, { voltage: 3.31 }])).toBe(9.93);
    expect(packVoltageV([{ voltage: 0.1 }, { voltage: 0.2 }])).toBe(0.3);
    expect(packVoltageV([])).toBeNull();
  });
  it("delta cell dalam mV", () => {
    expect(cellDeltaMv([{ voltage: 3.3 }, { voltage: 3.32 }, { voltage: 3.31 }])).toBe(20);
    expect(cellDeltaMv([{ voltage: 3.3 }])).toBe(0);
    expect(cellDeltaMv([])).toBeNull();
  });
  it("lastSeenAt = terbaru; baris lama tanpa receivedAt memakai updatedAt; tanpa pack = null", () => {
    expect(lastSeenAt([])).toBeNull();
    expect(lastSeenAt([pack({ receivedAt: null }), pack({ receivedAt: t("2026-09-21T09:00:00Z"), updatedAt: t("2026-09-21T08:00:00Z") })])?.toISOString()).toBe("2026-09-21T09:59:00.000Z");
  });
  it("online: dalam batas waktu saja; tanpa data = offline", () => {
    const now = t("2026-09-21T10:03:00Z");
    expect(isOnline(t("2026-09-21T10:00:00Z"), now, 180)).toBe(true); // tepat di batas
    expect(isOnline(t("2026-09-21T09:59:59Z"), now, 180)).toBe(false);
    expect(isOnline(null, now, 180)).toBe(false);
  });
  it("batas online bisa diatur env, ngawur -> default 180", () => {
    expect(onlineThresholdSec({ DEVICE_ONLINE_THRESHOLD_SEC: "300" })).toBe(300);
    expect(onlineThresholdSec({ DEVICE_ONLINE_THRESHOLD_SEC: "abc" })).toBe(180);
    expect(onlineThresholdSec({})).toBe(180);
  });
  it("deviceStats: suhu maks (abaikan null), delta maks, daya total, min/maks cell, tanpa SoC", () => {
    const s = deviceStats([
      pack({ index: 1, temperature: null, power: -20, cells: [{ voltage: 3.2 }, { voltage: 3.25 }] }),
      pack({ index: 0 }),
    ]);
    expect(s.packs.map((p) => p.index)).toEqual([0, 1]); // terurut
    expect(s.maxTemperatureC).toBe(25);
    expect(s.totalPowerW).toBe(-100);
    expect(s.maxCellDeltaMv).toBe(50);
    expect(s.minCellVoltageV).toBe(3.2);
    expect(s.maxCellVoltageV).toBe(3.32);
    expect(JSON.stringify(s)).not.toMatch(/soc|soh|stateOfCharge/i);
  });
  it("semua sensor null / tanpa pack -> nilai null (bukan 0 atau NaN)", () => {
    const s = deviceStats([pack({ temperature: null, power: null, current: null })]);
    expect(s.maxTemperatureC).toBeNull();
    expect(s.totalPowerW).toBeNull();
    const empty = deviceStats([]);
    expect(empty).toEqual({ packs: [], maxTemperatureC: null, maxCellDeltaMv: null, totalPowerW: null, minCellVoltageV: null, maxCellVoltageV: null });
  });
});
