import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SignJWT, UnsecuredJWT } from "jose";
import { AccessSecretError, AUDIENCE, ISSUER, generateRefreshToken, hashRefreshToken, signAccessToken, verifyAccessToken } from "./tokens";

const SECRET = "test-access-secret-".padEnd(48, "x");
const claims = { userId: "u1", tokenVersion: 4, familyId: "fam-1" };
const saved = { ...process.env };

beforeEach(() => {
  process.env.JWT_ACCESS_SECRET = SECRET;
  process.env.NEXTAUTH_SECRET = "different-nextauth-secret-".padEnd(48, "y");
  delete process.env.ACCESS_TOKEN_TTL_SEC;
});
afterEach(() => {
  process.env = { ...saved };
});

const now = () => Math.floor(Date.now() / 1000);

describe("access token", () => {
  it("roundtrip: klaim kembali utuh", async () => {
    const t = await signAccessToken(claims);
    expect(await verifyAccessToken(t)).toEqual(claims);
  });
  it("kedaluwarsa setelah TTL (default 15 menit)", async () => {
    const t = await signAccessToken(claims, now() - 16 * 60);
    expect(await verifyAccessToken(t)).toBeNull();
  });
  it("masih valid tepat sebelum kedaluwarsa", async () => {
    const t = await signAccessToken(claims, now() - 14 * 60);
    expect(await verifyAccessToken(t)).toEqual(claims);
  });
  it("TTL bisa diatur lewat env", async () => {
    process.env.ACCESS_TOKEN_TTL_SEC = "60";
    expect(await verifyAccessToken(await signAccessToken(claims, now() - 120))).toBeNull();
    expect(await verifyAccessToken(await signAccessToken(claims, now() - 30))).toEqual(claims);
  });
  it("ditolak bila ditandatangani secret lain (mis. NEXTAUTH_SECRET) — secret harus terpisah", async () => {
    const forged = await new SignJWT({ tv: 4, sid: "fam-1" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("u1").setIssuer(ISSUER).setAudience(AUDIENCE)
      .setIssuedAt().setExpirationTime("15m")
      .sign(new TextEncoder().encode(process.env.NEXTAUTH_SECRET!));
    expect(await verifyAccessToken(forged)).toBeNull();
  });
  it("ditolak: algoritma 'none' (unsecured JWT)", async () => {
    const t = new UnsecuredJWT({ tv: 4, sid: "f" }).setSubject("u1").setIssuer(ISSUER).setAudience(AUDIENCE).setExpirationTime("15m").encode();
    expect(await verifyAccessToken(t)).toBeNull();
  });
  it("ditolak: issuer/audience salah", async () => {
    const key = new TextEncoder().encode(SECRET);
    const mk = (iss: string, aud: string) =>
      new SignJWT({ tv: 4, sid: "f" }).setProtectedHeader({ alg: "HS256" }).setSubject("u1").setIssuer(iss).setAudience(aud).setExpirationTime("15m").sign(key);
    expect(await verifyAccessToken(await mk("evil", AUDIENCE))).toBeNull();
    expect(await verifyAccessToken(await mk(ISSUER, "other"))).toBeNull();
  });
  it("ditolak: payload dimodifikasi / sampah / klaim wajib hilang", async () => {
    const t = await signAccessToken(claims);
    const [h, p, s] = t.split(".");
    const tampered = `${h}.${Buffer.from(JSON.stringify({ sub: "admin", tv: 4, sid: "f", iss: ISSUER, aud: AUDIENCE, exp: now() + 999 })).toString("base64url")}.${s}`;
    expect(await verifyAccessToken(tampered)).toBeNull();
    expect(await verifyAccessToken("bukan.jwt.sama-sekali")).toBeNull();
    expect(await verifyAccessToken("")).toBeNull();
    const noClaims = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setIssuer(ISSUER).setAudience(AUDIENCE).setExpirationTime("15m").sign(new TextEncoder().encode(SECRET));
    expect(await verifyAccessToken(noClaims)).toBeNull();
    void p;
  });
  it("melempar AccessSecretError (bukan menerima token) bila secret server salah", async () => {
    delete process.env.JWT_ACCESS_SECRET;
    await expect(verifyAccessToken("a.b.c")).rejects.toBeInstanceOf(AccessSecretError);
    await expect(signAccessToken(claims)).rejects.toBeInstanceOf(AccessSecretError);
  });
});

describe("refresh token", () => {
  it("acak 256-bit, unik, hash sha256 hex deterministik dan bukan token mentah", () => {
    const a = generateRefreshToken(), b = generateRefreshToken();
    expect(a.raw).not.toBe(b.raw);
    expect(a.raw.length).toBeGreaterThanOrEqual(43);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(hashRefreshToken(a.raw));
    expect(a.hash).not.toContain(a.raw);
  });
});
