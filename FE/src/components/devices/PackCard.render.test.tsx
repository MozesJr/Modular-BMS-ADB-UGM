import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PackCard from "@/components/devices/PackCard";
import type { Pack } from "@/types/device";

const cells = Array.from({ length: 24 }, (_, i) => ({ id: `c${i}`, index: i + 1, voltage: 3.294 + (i % 3) * 0.001, updatedAt: "2026-11-04T00:00:00Z" }));
const basePack: Pack = {
  id: "p1", index: 1, temperature: null, balancerConnected: true, current: 0, power: 0,
  soc: null, remainingCapacity: null, capacity: null, balancing: null, cells, updatedAt: "2026-11-04T00:00:00Z",
};
// Penanda unik chip "Balancing/Idle" (badge status arus "Idle" di header adalah hal lain).
const BALANCING_CHIP = "Status balancing aktual dari BMS saat ini";
const html = (over: Partial<Pack>) => renderToStaticMarkup(<PackCard pack={{ ...basePack, ...over }} freshness="live" />).replace(/<!-- -->/g, "");

describe("PackCard (render)", () => {
  it("payload JK-BMS: SoC (BMS) utama + kapasitas + estimasi pembanding + Idle (bukan Active) + suhu N/A", () => {
    const out = html({ soc: 69, remainingCapacity: 20.7, capacity: 30, balancing: false });
    expect(out).toContain("SoC (BMS)");
    expect(out).toContain("20.7 / 30.0 Ah");
    expect(out).toContain("SoC Estimasi (voltage-based)");
    expect(out).toContain("kurang akurat untuk LiFePO4");
    expect(out).toContain("Balancer: Terhubung");
    expect(out).toContain(BALANCING_CHIP);
    expect(out).toMatch(/Status balancing aktual[^>]*>.*?>Idle<\/span>/);
    expect(out).not.toContain("Active");
    expect(out).not.toContain(">Balancing<");
    expect(out).toContain("N/A");
    expect(out).not.toContain("Error");
    expect(out).toContain("SoC 69%"); // digital twin tanpa "~"
  });

  it("balancing=true -> badge Balancing", () => {
    const out = html({ soc: 69, balancing: true });
    expect(out).toContain(BALANCING_CHIP);
    expect(out).toContain(">Balancing<");
    expect(out).not.toContain("Active");
  });

  it("device lama (semua field baru null): perilaku lama, hanya estimasi, tanpa badge balancing/kapasitas", () => {
    const out = html({ temperature: 27.5 });
    expect(out).toContain("SoC · Estimasi (voltage-based)");
    expect(out).not.toContain("SoC (BMS)");
    expect(out).not.toContain("Ah<");
    expect(out).not.toContain(BALANCING_CHIP);
    expect(out).not.toContain(">Balancing<");
    expect(out).toContain("Balancer: Terhubung");
    expect(out).toContain("SoC ~");
    expect(out).toContain("27.5");
  });

  it("balancer tidak terhubung -> 'Tidak terhubung'", () => {
    expect(html({ balancerConnected: false })).toContain("Balancer: Tidak terhubung");
  });
});
