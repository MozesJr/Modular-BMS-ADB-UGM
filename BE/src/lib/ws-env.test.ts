import { describe, expect, it } from "vitest";
import { checkWsEnv, parseAllowedOrigins, wsAllowedOrigins, WS_DEV_DEFAULT_ORIGINS } from "./env-check";

describe("WS_ALLOWED_ORIGINS", () => {
  it("menormalkan origin (slash akhir, huruf besar) dan memisahkan dengan koma", () => {
    expect(parseAllowedOrigins("https://Gamabms.tech/, http://localhost:3000").origins).toEqual([
      "https://gamabms.tech",
      "http://localhost:3000",
    ]);
  });
  it("menandai entri yang bukan origin murni", () => {
    expect(parseAllowedOrigins("https://a.com/path, ftp://x, bukan-url").invalid).toHaveLength(3);
  });
  it("produksi tanpa WS_ALLOWED_ORIGINS gagal; origin dev tidak otomatis berlaku", () => {
    expect(checkWsEnv({ NODE_ENV: "production" })[0]).toMatch(/WS_ALLOWED_ORIGINS belum diset/);
    expect(wsAllowedOrigins({ NODE_ENV: "production" })).toEqual([]);
  });
  it("produksi dengan origin valid lolos", () => {
    expect(checkWsEnv({ NODE_ENV: "production", WS_ALLOWED_ORIGINS: "https://gamabms.tech" })).toEqual([]);
  });
  it("development default mencakup FE lokal port 3000 dan 3001", () => {
    expect(wsAllowedOrigins({ NODE_ENV: "development" })).toEqual(WS_DEV_DEFAULT_ORIGINS);
    expect(WS_DEV_DEFAULT_ORIGINS).toContain("http://localhost:3000");
    expect(WS_DEV_DEFAULT_ORIGINS).toContain("http://localhost:3001");
  });
  it("angka env harus bilangan bulat positif", () => {
    expect(checkWsEnv({ WS_PING_SEC: "abc" })[0]).toMatch(/WS_PING_SEC/);
    expect(checkWsEnv({ WS_MAX_CONN_PER_USER: "0" })[0]).toMatch(/WS_MAX_CONN_PER_USER/);
  });
});
