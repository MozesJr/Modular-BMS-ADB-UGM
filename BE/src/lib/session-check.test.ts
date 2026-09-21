import { describe, expect, it } from "vitest";
import { checkSessionAgainstUser } from "./session-check";

const now = Date.parse("2026-09-21T10:00:00Z");
const user = { id: "u1", role: "USER" as const, expiresAt: null, tokenVersion: 3 };

describe("checkSessionAgainstUser", () => {
  it("menerima sesi dengan versi sama dan akun aktif", () => {
    expect(checkSessionAgainstUser({ id: "u1", tokenVersion: 3 }, user, now)).toEqual({ ok: true });
  });
  it("menolak bila user sudah tidak ada", () => {
    expect(checkSessionAgainstUser({ id: "u1", tokenVersion: 3 }, null, now)).toEqual({ ok: false, reason: "user_missing" });
  });
  it("menolak SEKETIKA bila akun sudah expired (walau JWT masih berlaku)", () => {
    const expired = { ...user, expiresAt: new Date(now - 1) };
    expect(checkSessionAgainstUser({ id: "u1", tokenVersion: 3 }, expired, now)).toEqual({ ok: false, reason: "expired" });
  });
  it("expiresAt di masa depan masih boleh", () => {
    expect(checkSessionAgainstUser({ id: "u1", tokenVersion: 3 }, { ...user, expiresAt: new Date(now + 1000) }, now).ok).toBe(true);
  });
  it("menolak bila tokenVersion di token beda (password diganti/direset)", () => {
    expect(checkSessionAgainstUser({ id: "u1", tokenVersion: 2 }, user, now)).toEqual({
      ok: false,
      reason: "token_version_mismatch",
    });
  });
  it("JWT lama tanpa tokenVersion dianggap 0: valid selama versi user masih 0, ditolak setelah naik", () => {
    expect(checkSessionAgainstUser({ id: "u1" }, { ...user, tokenVersion: 0 }, now).ok).toBe(true);
    expect(checkSessionAgainstUser({ id: "u1" }, { ...user, tokenVersion: 1 }, now).ok).toBe(false);
  });
});
