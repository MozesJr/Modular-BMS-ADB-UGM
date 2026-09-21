import { describe, expect, it } from "vitest";
import { ProvisionLimiter } from "./provision-limit";

const H = 60 * 60 * 1000;

describe("ProvisionLimiter", () => {
  it("mengizinkan sampai N per jam lalu menolak", () => {
    const l = new ProvisionLimiter(3);
    const t = 1_000_000;
    expect([1, 2, 3, 4].map((i) => l.tryAcquire(t + i))).toEqual([true, true, true, false]);
  });
  it("kuota pulih setelah satu jam", () => {
    const l = new ProvisionLimiter(1);
    const t = 5_000_000;
    expect(l.tryAcquire(t)).toBe(true);
    expect(l.tryAcquire(t + H - 1)).toBe(false);
    expect(l.tryAcquire(t + H + 1)).toBe(true);
  });
  it("0 = mati total", () => {
    expect(new ProvisionLimiter(0).tryAcquire(1)).toBe(false);
  });
  it("permintaan yang ditolak tidak memakan kuota", () => {
    const l = new ProvisionLimiter(1);
    l.tryAcquire(10);
    for (let i = 0; i < 100; i++) l.tryAcquire(20 + i);
    expect(l.used).toBe(1);
  });
});
