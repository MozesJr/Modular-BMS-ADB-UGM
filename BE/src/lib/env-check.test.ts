import { describe, expect, it } from "vitest";
import { checkRequiredEnv } from "./env-check";

const good = "x".repeat(40);

describe("checkRequiredEnv (fail-fast JWT_ACCESS_SECRET)", () => {
  it("OK bila secret cukup panjang dan berbeda dari NEXTAUTH_SECRET", () => {
    expect(checkRequiredEnv({ JWT_ACCESS_SECRET: good, NEXTAUTH_SECRET: "y".repeat(40) })).toEqual([]);
  });
  it("gagal bila tidak diset", () => {
    expect(checkRequiredEnv({})[0]).toMatch(/belum diset/);
  });
  it("gagal bila kurang dari 32 karakter", () => {
    expect(checkRequiredEnv({ JWT_ACCESS_SECRET: "pendek" })[0]).toMatch(/terlalu pendek/);
  });
  it("gagal bila sama dengan NEXTAUTH_SECRET", () => {
    expect(checkRequiredEnv({ JWT_ACCESS_SECRET: good, NEXTAUTH_SECRET: good })[0]).toMatch(/tidak boleh sama/);
  });
  it("pesan tidak pernah memuat nilai secret", () => {
    const secret = "rahasia-".repeat(6);
    const msgs = checkRequiredEnv({ JWT_ACCESS_SECRET: secret, NEXTAUTH_SECRET: secret });
    expect(msgs.join(" ")).not.toContain(secret);
  });
});
