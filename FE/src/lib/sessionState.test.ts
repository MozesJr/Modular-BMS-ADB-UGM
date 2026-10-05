import { describe, expect, it } from "vitest";
import { evaluateSession, isLoggedIn } from "./sessionState";

const now = Date.parse("2026-10-05T10:00:00Z");
const sec = (ms: number) => Math.floor(ms / 1000);

describe("evaluateSession (satu-satunya penentu 'sudah login' di proxy)", () => {
  it("tanpa token = anonim", () => {
    expect(evaluateSession(null, now)).toEqual({ status: "anonymous" });
  });
  it("deadline di masa depan = login", () => {
    expect(isLoggedIn(evaluateSession({ ida: sec(now) + 60 }, now))).toBe(true);
  });
  it("deadline lewat = idle (bukan login), tepat di batas pun idle", () => {
    expect(evaluateSession({ ida: sec(now) - 1 }, now)).toEqual({ status: "idle", legacy: false });
    expect(evaluateSession({ ida: sec(now) }, now)).toEqual({ status: "idle", legacy: false });
  });
  it("JWT lama tanpa klaim ida = idle legacy (tanpa grandfather)", () => {
    expect(evaluateSession({}, now)).toEqual({ status: "idle", legacy: true });
    expect(evaluateSession({ ida: "123" }, now)).toEqual({ status: "idle", legacy: true });
    expect(evaluateSession({ ida: Number.NaN }, now)).toEqual({ status: "idle", legacy: true });
  });
  it("akun expired didahulukan", () => {
    expect(evaluateSession({ ida: sec(now) + 60, expiresAt: "2026-10-05T09:00:00Z" }, now)).toEqual({ status: "expired" });
  });
});
