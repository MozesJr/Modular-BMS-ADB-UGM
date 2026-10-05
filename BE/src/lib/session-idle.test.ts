import { describe, expect, it } from "vitest";
import { checkSessionEnv } from "./env-check";
import { evaluateJwtIdle, idleConfig, idleDeadlineSec, isIdleExpired, remainingIdleSec } from "./session-idle";

const T = 30 * 60;

describe("idleConfig", () => {
  it("default 30 menit dan peringatan 60 detik", () => {
    expect(idleConfig({})).toEqual({ timeoutSec: 1800, warningSec: 60 });
  });
  it("membaca env; nilai tidak valid jatuh ke default; peringatan selalu < batas", () => {
    expect(idleConfig({ SESSION_IDLE_MINUTES: "2", SESSION_IDLE_WARNING_SECONDS: "30" })).toEqual({ timeoutSec: 120, warningSec: 30 });
    expect(idleConfig({ SESSION_IDLE_MINUTES: "abc" }).timeoutSec).toBe(1800);
    expect(idleConfig({ SESSION_IDLE_MINUTES: "1", SESSION_IDLE_WARNING_SECONDS: "999" }).warningSec).toBe(59);
  });
  it("env-check menolak nilai buruk dan warning >= batas", () => {
    expect(checkSessionEnv({})).toEqual([]);
    expect(checkSessionEnv({ SESSION_IDLE_MINUTES: "0" })[0]).toMatch(/SESSION_IDLE_MINUTES/);
    expect(checkSessionEnv({ SESSION_IDLE_MINUTES: "1", SESSION_IDLE_WARNING_SECONDS: "60" }).join()).toMatch(/lebih kecil/);
  });
});

describe("batas idle di server", () => {
  const login = 1_000_000;
  const deadline = idleDeadlineSec(login, T);

  it("sesi diterima sebelum batas dan DITOLAK setelah batas idle", () => {
    expect(isIdleExpired(deadline, login + T - 1)).toBe(false);
    expect(isIdleExpired(deadline, login + T)).toBe(true);
    expect(isIdleExpired(deadline, login + T + 3600)).toBe(true);
  });

  it("aktivitas (update eksplisit) memperpanjang batas", () => {
    const at = login + 20 * 60;
    const d = evaluateJwtIdle({ deadlineSec: deadline, nowSec: at, timeoutSec: T, explicitTouch: true });
    expect(d).toEqual({ kind: "ok", deadlineSec: at + T, extended: true });
    // setelah update, sesi masih hidup melewati batas lama
    expect(isIdleExpired((d as { deadlineSec: number }).deadlineSec, login + T + 60)).toBe(false);
  });

  it("request otomatis (pembacaan biasa/polling) TIDAK memperpanjang: deadline dibawa apa adanya dan akhirnya idle", () => {
    let cur = deadline;
    for (let t = login; t < login + T; t += 60) {
      const d = evaluateJwtIdle({ deadlineSec: cur, nowSec: t, timeoutSec: T, explicitTouch: false });
      expect(d).toEqual({ kind: "ok", deadlineSec: deadline, extended: false });
      cur = (d as { deadlineSec: number }).deadlineSec;
    }
    expect(evaluateJwtIdle({ deadlineSec: cur, nowSec: login + T, timeoutSec: T, explicitTouch: false })).toEqual({ kind: "expired" });
  });

  it("sesi yang sudah idle tidak bisa dihidupkan lagi oleh update", () => {
    expect(evaluateJwtIdle({ deadlineSec: deadline, nowSec: login + T + 1, timeoutSec: T, explicitTouch: true })).toEqual({ kind: "expired" });
  });

  it("klaim hilang (JWT lama) atau rusak = idle, tanpa grandfather", () => {
    for (const bad of [undefined, null, "123", Number.NaN]) {
      expect(isIdleExpired(bad, login)).toBe(true);
      expect(evaluateJwtIdle({ deadlineSec: bad, nowSec: login, timeoutSec: T, explicitTouch: true })).toEqual({ kind: "expired" });
    }
  });

  it("remainingIdleSec tidak pernah negatif", () => {
    expect(remainingIdleSec(deadline, login)).toBe(T);
    expect(remainingIdleSec(deadline, login + T + 5)).toBe(0);
    expect(remainingIdleSec(undefined, login)).toBe(0);
  });
});
