import { describe, expect, it } from "vitest";
import { SlidingWindowLimiter } from "./rate-limit";

const W = 60_000;

describe("SlidingWindowLimiter", () => {
  it("mengizinkan sampai batas lalu menolak dengan Retry-After", () => {
    const l = new SlidingWindowLimiter();
    const t = 1_000_000 * W; // awal jendela
    for (let i = 0; i < 3; i++) expect(l.hit("k", 3, W, t + i).allowed).toBe(true);
    const denied = l.hit("k", 3, W, t + 10);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSec).toBeGreaterThan(0);
    expect(denied.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it("kunci berbeda tidak saling mempengaruhi", () => {
    const l = new SlidingWindowLimiter();
    const t = 5 * W;
    l.hit("a", 1, W, t);
    expect(l.hit("a", 1, W, t + 1).allowed).toBe(false);
    expect(l.hit("b", 1, W, t + 1).allowed).toBe(true);
  });

  it("pulih setelah jendela berlalu", () => {
    const l = new SlidingWindowLimiter();
    const t = 7 * W;
    for (let i = 0; i < 5; i++) l.hit("k", 5, W, t + i);
    expect(l.hit("k", 5, W, t + 100).allowed).toBe(false);
    expect(l.hit("k", 5, W, t + 3 * W).allowed).toBe(true); // > 2 jendela kemudian: bersih
  });

  it("tidak ada lonjakan 2x di batas jendela (sliding)", () => {
    const l = new SlidingWindowLimiter();
    const start = 10 * W;
    // habiskan kuota di akhir jendela pertama
    for (let i = 0; i < 10; i++) expect(l.hit("k", 10, W, start + W - 1000 + i).allowed).toBe(true);
    // sesaat setelah pindah jendela, bobot jendela lama masih ~98% -> paling banyak 1 tambahan lolos
    // (fixed-window murni akan meloloskan 10 lagi = lonjakan 2x)
    let allowed = 0;
    for (let i = 0; i < 10; i++) if (l.hit("k", 10, W, start + W + 1000 + i).allowed) allowed++;
    expect(allowed).toBeLessThanOrEqual(1);
  });

  it("percobaan yang ditolak tidak memperpanjang blokir", () => {
    const l = new SlidingWindowLimiter();
    const t = 20 * W;
    l.hit("k", 1, W, t);
    for (let i = 0; i < 50; i++) l.hit("k", 1, W, t + 1000 + i);
    // begitu jendela + bobot habis, boleh lagi meski ada banyak percobaan ditolak sebelumnya
    expect(l.hit("k", 1, W, t + 2 * W + 1).allowed).toBe(true);
  });

  it("sweep membuang entri kedaluwarsa", () => {
    const l = new SlidingWindowLimiter();
    l.hit("old", 5, W, 0);
    l.hit("new", 5, W, 1000 * W);
    l.sweep(1000 * W);
    expect(l.size).toBe(1);
  });
});
