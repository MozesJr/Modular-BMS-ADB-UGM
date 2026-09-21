import { describe, expect, it } from "vitest";
import { etagOf, jsonWithEtag, matchesIfNoneMatch } from "./etag";
import { decodeCursor, encodeCursor } from "./cursor";
import { z } from "zod";

const req = (h: Record<string, string> = {}) => new Request("http://x/api/v1/y", { headers: h });

describe("ETag", () => {
  it("deterministik dan berubah bila isi berubah", () => {
    expect(etagOf({ a: 1 })).toBe(etagOf({ a: 1 }));
    expect(etagOf({ a: 1 })).not.toBe(etagOf({ a: 2 }));
    expect(etagOf({ a: 1 })).toMatch(/^W\/"[A-Za-z0-9_-]{27}"$/);
  });
  it("If-None-Match cocok -> 304 tanpa body; tidak cocok -> 200", async () => {
    const body = { x: 1 };
    const first = jsonWithEtag(req(), body);
    const tag = first.headers.get("etag")!;
    expect(first.status).toBe(200);
    const again = jsonWithEtag(req({ "if-none-match": tag }), body);
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    expect(again.headers.get("etag")).toBe(tag);
    expect(jsonWithEtag(req({ "if-none-match": 'W/"lain"' }), body).status).toBe(200);
  });
  it("mendukung daftar tag, tag kuat tanpa W/, dan *", () => {
    const tag = etagOf({ x: 1 });
    expect(matchesIfNoneMatch(`"a", ${tag}`, tag)).toBe(true);
    expect(matchesIfNoneMatch(tag.slice(2), tag)).toBe(true);
    expect(matchesIfNoneMatch("*", tag)).toBe(true);
    expect(matchesIfNoneMatch(null, tag)).toBe(false);
  });
  it("basis dapat mengecualikan field yang berubah tiap request (generatedAt)", () => {
    const a = jsonWithEtag(req(), { n: 1, generatedAt: "t1" }, { n: 1 });
    const b = jsonWithEtag(req(), { n: 1, generatedAt: "t2" }, { n: 1 });
    expect(a.headers.get("etag")).toBe(b.headers.get("etag"));
  });
  it("cache private, wajib revalidasi, Vary", () => {
    const r = jsonWithEtag(req(), {});
    expect(r.headers.get("cache-control")).toBe("private, no-cache");
    expect(r.headers.get("vary")).toContain("Authorization");
  });
});

describe("cursor", () => {
  const schema = z.object({ c: z.string(), i: z.string() });
  it("roundtrip", () => expect(decodeCursor(encodeCursor({ c: "2026-01-01T00:00:00.000Z", i: "abc" }), schema)).toEqual({ c: "2026-01-01T00:00:00.000Z", i: "abc" }));
  it.each(["", "###", Buffer.from("bukan json").toString("base64url"), Buffer.from('{"c":1}').toString("base64url")])("cursor rusak %j -> 400 INVALID_CURSOR", (bad) => {
    expect(() => decodeCursor(bad, schema)).toThrowError(expect.objectContaining({ status: 400, code: "INVALID_CURSOR" }));
  });
});
