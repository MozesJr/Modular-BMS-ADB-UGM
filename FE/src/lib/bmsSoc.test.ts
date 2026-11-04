import { describe, expect, it } from "vitest";
import { balancerState, bmsSocPercent, formatCapacityAh, resolvePackSoc } from "@/lib/packMetrics";
import { evaluateSnapshot } from "@/lib/alertRules";
import { applyRealtimeUpdate } from "@/lib/realtimeMerge";
import type { BmsUpdatePayload, Device } from "@/types/device";

describe("SoC BMS vs estimasi", () => {
  it("bmsSocPercent: null/undefined/NaN/di luar 0–100 = tidak ada (BUKAN 0); 0 dan 100 sah", () => {
    expect(bmsSocPercent(null)).toBeNull();
    expect(bmsSocPercent(undefined)).toBeNull();
    expect(bmsSocPercent(Number.NaN)).toBeNull();
    expect(bmsSocPercent(-1)).toBeNull();
    expect(bmsSocPercent(101)).toBeNull();
    expect(bmsSocPercent(0)).toBe(0);
    expect(bmsSocPercent(100)).toBe(100);
    expect(bmsSocPercent(69)).toBe(69);
  });

  it("SoC BMS jadi nilai utama dan estimasi tetap ada sebagai pembanding", () => {
    const r = resolvePackSoc(69, 24 * 3.3, 24);
    expect(r.source).toBe("bms");
    expect(r.primary).toBe(69);
    expect(r.bms).toBe(69);
    expect(r.estimate).toBeCloseTo(50, 0); // 3.30 V/cell ~ 50% pada tabel OCV
  });

  it("soc null -> perilaku lama: hanya estimasi", () => {
    const r = resolvePackSoc(null, 24 * 3.3, 24);
    expect(r.source).toBe("estimate");
    expect(r.bms).toBeNull();
    expect(r.primary).toBe(r.estimate);
  });

  it("soc 0 dari BMS tetap dipakai (bukan dianggap tidak ada)", () => {
    expect(resolvePackSoc(0, 24 * 3.3, 24)).toMatchObject({ source: "bms", primary: 0 });
  });

  it("tanpa cell dan tanpa soc -> tidak ada sumber", () => {
    expect(resolvePackSoc(null, 0, 0)).toEqual({ bms: null, estimate: null, primary: null, source: null });
  });

  it("formatCapacityAh", () => {
    expect(formatCapacityAh(20.7, 30)).toBe("20.7 / 30.0 Ah");
    expect(formatCapacityAh(null, 30)).toBe("— / 30.0 Ah");
    expect(formatCapacityAh(20.7, null)).toBe("20.7 / — Ah");
    expect(formatCapacityAh(null, null)).toBeNull();
    expect(formatCapacityAh(0, 30)).toBe("0.0 / 30.0 Ah");
  });
});

describe("badge balancer", () => {
  it("balancing=false -> idle (tidak 'Active'); true -> balancing; null -> unknown", () => {
    expect(balancerState(false)).toBe("idle");
    expect(balancerState(true)).toBe("balancing");
    expect(balancerState(null)).toBe("unknown");
    expect(balancerState(undefined)).toBe("unknown");
  });
});

describe("suhu null (probe NTC belum terpasang)", () => {
  it("tidak memicu alarm over_temperature", () => {
    const alarms = evaluateSnapshot(
      [{ index: 1, temperature: null, cells: [{ index: 1, voltage: 3.3 }, { index: 2, voltage: 3.31 }] }],
      "live",
    );
    expect(alarms).toEqual([]);
  });
  it("suhu tinggi nyata tetap memicu alarm", () => {
    const alarms = evaluateSnapshot([{ index: 1, temperature: 60, cells: [{ index: 1, voltage: 3.3 }] }], "live");
    expect(alarms.map((a) => a.rule)).toEqual(["over_temperature"]);
  });
});

describe("realtimeMerge field BMS", () => {
  const device = { packs: [], lastSeen: null } as unknown as Device;
  const update = (extra: Record<string, unknown>) =>
    ({
      id: "d",
      serialNumber: "S",
      timestamp: 1,
      packs: [{ index: 1, temperature: null, balancerConnected: true, cells: [{ index: 1, voltage: 3.3 }], ...extra }],
    }) as unknown as BmsUpdatePayload;

  it("meneruskan soc/kapasitas/balancing dari event WS", () => {
    const next = applyRealtimeUpdate(device, update({ soc: 69, remainingCapacity: 20.7, capacity: 30, balancing: false }));
    expect(next.packs[0]).toMatchObject({ soc: 69, remainingCapacity: 20.7, capacity: 30, balancing: false, temperature: null });
  });
  it("event tanpa field BMS -> null (bukan nilai lama / 0)", () => {
    const first = applyRealtimeUpdate(device, update({ soc: 69, balancing: true }));
    const next = applyRealtimeUpdate(first, update({}));
    expect(next.packs[0]).toMatchObject({ soc: null, remainingCapacity: null, capacity: null, balancing: null });
  });
});
