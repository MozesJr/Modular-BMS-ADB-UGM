import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";

// Menjalankan proxy() sungguhan dengan cookie sesi Auth.js asli (dienkripsi) untuk memastikan rantai redirect berhenti.
const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const SALT = "authjs.session-token";
const ORIGIN = "http://localhost:3000";
let proxy: typeof import("./proxy").proxy;

beforeAll(async () => {
  process.env.NEXTAUTH_SECRET = SECRET;
  delete process.env.NEXTAUTH_URL;
  delete process.env.VERCEL;
  ({ proxy } = await import("./proxy"));
});

const nowSec = () => Math.floor(Date.now() / 1000);
async function cookie(claims: Record<string, unknown> | null): Promise<string> {
  if (!claims) return "";
  const token = await encode({ token: { id: "u1", role: "USER", expiresAt: null, ...claims }, secret: SECRET, salt: SALT, maxAge: 3600 });
  return `${SALT}=${token}`;
}
const req = (path: string, c: string) => new NextRequest(`${ORIGIN}${path}`, { headers: c ? { cookie: c } : {} });
const location = (res: Response) => res.headers.get("location");
const passes = (res: Response) => res.headers.get("x-middleware-next") === "1" && location(res) === null;

describe("proxy: sesi idle tidak boleh membuat loop redirect", () => {
  it("cookie idle masih ada, buka /signin -> halaman signin tampil (bukan redirect ke /)", async () => {
    const idle = await cookie({ ida: nowSec() - 30 });
    expect(passes(await proxy(req("/signin", idle)))).toBe(true);
    expect(passes(await proxy(req("/signin?reason=idle&callbackUrl=%2Fdevices", idle)))).toBe(true);
    expect(passes(await proxy(req("/signup", idle)))).toBe(true);
    expect(passes(await proxy(req("/forgot-password", idle)))).toBe(true);
  });

  it("cookie idle, buka halaman terproteksi -> /signin?reason=idle dan rantai redirect BERHENTI di sana", async () => {
    const idle = await cookie({ ida: nowSec() - 30 });
    const first = await proxy(req("/devices/abc?tab=history", idle));
    expect(first.status).toBe(307);
    const target = new URL(location(first)!);
    expect(target.pathname).toBe("/signin");
    expect(target.searchParams.get("reason")).toBe("idle");
    expect(target.searchParams.get("callbackUrl")).toBe("/devices/abc?tab=history");
    // ikuti redirect dengan cookie yang sama: harus berhenti (halaman signin), tidak memantul lagi
    const second = await proxy(req(target.pathname + target.search, idle));
    expect(passes(second)).toBe(true);
  });

  it("JWT lama tanpa klaim ida ditolak tanpa loop (reason=expired, bukan pesan idle)", async () => {
    const legacy = await cookie({});
    const first = await proxy(req("/", legacy));
    expect(first.status).toBe(307);
    const target = new URL(location(first)!);
    expect(target.pathname).toBe("/signin");
    expect(target.searchParams.get("reason")).toBe("expired");
    expect(passes(await proxy(req(target.pathname + target.search, legacy)))).toBe(true);
    expect(passes(await proxy(req("/signin", legacy)))).toBe(true);
  });

  it("tanpa cookie: protected -> /signin (tanpa reason), signin tampil", async () => {
    const first = await proxy(req("/devices", ""));
    const target = new URL(location(first)!);
    expect(target.pathname).toBe("/signin");
    expect(target.searchParams.get("reason")).toBeNull();
    expect(passes(await proxy(req("/signin", "")))).toBe(true);
  });

  it("sesi sah: protected lolos; halaman auth -> redirect ke /", async () => {
    const ok = await cookie({ ida: nowSec() + 600 });
    expect(passes(await proxy(req("/devices", ok)))).toBe(true);
    const auth = await proxy(req("/signin", ok));
    expect(auth.status).toBe(307);
    expect(new URL(location(auth)!).pathname).toBe("/");
  });

  it("akun expired tetap reason=expired; /admin hanya untuk ADMIN", async () => {
    const expired = await cookie({ ida: nowSec() + 600, expiresAt: "2020-01-01T00:00:00Z" });
    expect(new URL(location(await proxy(req("/devices", expired)))!).searchParams.get("reason")).toBe("expired");
    const user = await cookie({ ida: nowSec() + 600, role: "USER" });
    expect(new URL(location(await proxy(req("/admin/users", user)))!).pathname).toBe("/");
    const admin = await cookie({ ida: nowSec() + 600, role: "ADMIN" });
    expect(passes(await proxy(req("/admin/users", admin)))).toBe(true);
  });
});
