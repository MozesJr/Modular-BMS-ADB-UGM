import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { ApiError, err, parseJson, route } from "./http";
import { emailSchema, expiresAtSchema, newPasswordSchema, serialNumberSchema } from "@/contracts/common";

vi.spyOn(console, "error").mockImplementation(() => {});

const req = (body?: string, headers: Record<string, string> = {}) =>
  new Request("http://x/api/test", { method: "POST", body, headers });

async function run(handler: () => Promise<Response>, headers: Record<string, string> = {}) {
  const res = await route(handler)(req(undefined, headers), undefined);
  return { res, body: await res.json() };
}

describe("route() error mapping", () => {
  it("ApiError -> {error:{code,message},requestId} + header X-Request-Id", async () => {
    const { res, body } = await run(async () => {
      throw err.notFound("Device tidak ditemukan", "DEVICE_NOT_FOUND");
    });
    expect(res.status).toBe(404);
    expect(body.error).toEqual({ code: "DEVICE_NOT_FOUND", message: "Device tidak ditemukan" });
    expect(body.requestId).toBe(res.headers.get("X-Request-Id"));
  });

  it("memakai X-Request-Id masuk bila valid, mengabaikan yang aneh", async () => {
    expect((await run(async () => { throw err.forbidden(); }, { "x-request-id": "abc-12345678" })).body.requestId).toBe("abc-12345678");
    const bad = (await run(async () => { throw err.forbidden(); }, { "x-request-id": "bad id <script>" })).body.requestId;
    expect(bad).not.toContain("<script>");
    expect(bad).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("429 membawa Retry-After", async () => {
    const { res, body } = await run(async () => {
      throw err.tooMany(42);
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  it("P2002 -> 409, P2025 -> 404", async () => {
    const mk = (code: string) => new Prisma.PrismaClientKnownRequestError("x", { code, clientVersion: "5" });
    expect((await run(async () => { throw mk("P2002"); })).res.status).toBe(409);
    expect((await run(async () => { throw mk("P2025"); })).res.status).toBe(404);
  });

  it("error tak dikenal -> 500 INTERNAL tanpa membocorkan pesan asli", async () => {
    const { res, body } = await run(async () => {
      throw new Error("password=hunter2 connection refused");
    });
    expect(res.status).toBe(500);
    expect(body.error).toEqual({ code: "INTERNAL", message: "Terjadi kesalahan pada server" });
    expect(JSON.stringify(body)).not.toContain("hunter2");
  });

  it("sukses tetap mendapat X-Request-Id", async () => {
    const { res } = await run(async () => Response.json({ ok: true }));
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
  });
});

describe("parseJson", () => {
  const schema = z.object({ email: emailSchema });
  it("JSON rusak -> 400 INVALID_JSON", async () => {
    await expect(parseJson(req("{oops"), schema)).rejects.toMatchObject({ status: 400, code: "INVALID_JSON" });
  });
  it("skema gagal -> 400 VALIDATION_ERROR dengan details", async () => {
    const e = (await parseJson(req(JSON.stringify({ email: "bukan-email" })), schema).then(
      () => null,
      (x: unknown) => x,
    )) as ApiError;
    expect(e).toMatchObject({ status: 400, code: "VALIDATION_ERROR" });
    expect((e.details as { path: string }[])[0].path).toBe("email");
  });
  it("body terlalu besar -> 413", async () => {
    await expect(parseJson(req("x".repeat(70_000)), schema)).rejects.toMatchObject({ status: 413 });
  });
  it("body valid diterima dan di-trim", async () => {
    expect(await parseJson(req(JSON.stringify({ email: "  a@b.co " })), schema)).toEqual({ email: "a@b.co" });
  });
});

describe("contracts/common", () => {
  it("password: min 8 dan maksimal 72 byte (bcrypt)", () => {
    expect(newPasswordSchema.safeParse("1234567").success).toBe(false);
    expect(newPasswordSchema.safeParse("12345678").success).toBe(true);
    expect(newPasswordSchema.safeParse("a".repeat(73)).success).toBe(false);
    expect(newPasswordSchema.safeParse("é".repeat(37)).success).toBe(false); // 74 byte
  });
  it("serialNumber hanya karakter aman untuk topik MQTT", () => {
    expect(serialNumberSchema.safeParse("GAMA-BMS-PACK-001").success).toBe(true);
    for (const bad of ["a/b", "a+b", "a#b", "a b", "", "x".repeat(65)]) {
      expect(serialNumberSchema.safeParse(bad).success).toBe(false);
    }
  });
  it("expiresAt: tanggal, null, string kosong; tanggal ngawur ditolak", () => {
    expect(expiresAtSchema.parse("2026-12-31")).toBeInstanceOf(Date);
    expect(expiresAtSchema.parse(null)).toBeNull();
    expect(expiresAtSchema.parse("")).toBeNull();
    expect(expiresAtSchema.safeParse("bukan tanggal").success).toBe(false);
  });
});
