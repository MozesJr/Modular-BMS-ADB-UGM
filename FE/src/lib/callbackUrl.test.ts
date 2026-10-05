import { describe, expect, it } from "vitest";
import { buildSignInUrl, sanitizeCallbackUrl } from "./callbackUrl";

describe("sanitizeCallbackUrl", () => {
  it("menerima path relatif satu '/' (dengan query dan hash)", () => {
    expect(sanitizeCallbackUrl("/devices/abc?tab=history#top")).toBe("/devices/abc?tab=history#top");
    expect(sanitizeCallbackUrl("/")).toBe("/");
  });
  it.each([
    "//evil.com",
    "//evil.com/path",
    "/\\evil.com",
    "\\\\evil.com",
    "/path\\with\\backslash",
    "https://evil.com",
    "http://evil.com/x",
    "javascript:alert(1)",
    "/redirect?to=https://evil.com/../..", // mengandung skema di path? query boleh, tapi ini diuji di bawah
    "evil.com",
    "",
    "/ok\r\nSet-Cookie: x=1",
    "/tab\there",
    "/foo://bar",
  ])("menolak %j (kecuali query biasa)", (raw) => {
    const result = sanitizeCallbackUrl(raw);
    if (raw.startsWith("/redirect?to=")) expect(result).toBe(raw); // skema di dalam QUERY bukan open redirect
    else expect(result).toBeNull();
  });
  it("menolak null/undefined/bukan string/terlalu panjang", () => {
    expect(sanitizeCallbackUrl(null)).toBeNull();
    expect(sanitizeCallbackUrl(undefined)).toBeNull();
    expect(sanitizeCallbackUrl("/" + "a".repeat(3000))).toBeNull();
  });
  it("menolak halaman auth supaya tidak memantul balik", () => {
    for (const p of ["/signin", "/signin?x=1", "/signup", "/forgot-password", "/reset-password/abc"]) {
      expect(sanitizeCallbackUrl(p)).toBeNull();
    }
  });
});

describe("buildSignInUrl", () => {
  it("memuat reason dan callbackUrl yang aman (ter-encode)", () => {
    expect(buildSignInUrl({ reason: "idle", from: "/devices/a?x=1" })).toBe("/signin?reason=idle&callbackUrl=%2Fdevices%2Fa%3Fx%3D1");
  });
  it("membuang callbackUrl berbahaya atau '/' ; tanpa reason = tanpa parameter", () => {
    expect(buildSignInUrl({ reason: "idle", from: "//evil.com" })).toBe("/signin?reason=idle");
    expect(buildSignInUrl({ from: "/" })).toBe("/signin");
    expect(buildSignInUrl({})).toBe("/signin");
  });
});
