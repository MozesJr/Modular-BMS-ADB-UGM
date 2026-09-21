/**
 * Smoke test API v1 end-to-end terhadap Postgres SEKALI-PAKAI:  npm run smoke:api
 * (menyalakan DB sekali-pakai + server BE sendiri; tidak menyentuh DB/server lain)
 * Bagian: auth token (B2) · me/devices/dashboard (B3) · history (B4) · collaborator & manajemen device (B5).
 */
import { PrismaClient } from "@prisma/client";
import { createUser, makeClient, Reporter, requireTestDb, spawnServer, waitHealth, serverEnv, SMOKE_NEXTAUTH_SECRET } from "./_smoke-lib";
import { spawnSync } from "node:child_process";
import { TokenResponseSchema, ErrorResponseSchema } from "../src/contracts/schemas";
import { SignJWT } from "jose";

const dbUrl = requireTestDb();
const PORT = Number(process.env.SMOKE_PORT ?? 4100);
const BASE = process.env.SMOKE_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
const call = makeClient(BASE);
const R = new Reporter();
const PW = "correct-horse-battery";
const tag = Date.now();

async function authSection() {
  const u = await createUser(prisma, `auth${tag}@smoke.test`, PW);
  const bad = await call("POST", "/api/v1/auth/login", { body: { email: u.email, password: "salah-salah" }, ip: "10.2.0.1" });
  const unknown = await call("POST", "/api/v1/auth/login", { body: { email: `nobody${tag}@smoke.test`, password: "salah-salah" }, ip: "10.2.0.2" });
  R.ok("login password salah -> 401 INVALID_CREDENTIALS", bad.status === 401 && bad.json?.error?.code === "INVALID_CREDENTIALS", JSON.stringify(bad.json));
  R.ok("login email tak terdaftar -> respons IDENTIK (tanpa enumerasi)", unknown.status === 401 && unknown.json?.error?.code === bad.json?.error?.code && unknown.json?.error?.message === bad.json?.error?.message);
  R.schema("error login", ErrorResponseSchema, bad.json);

  const val = await call("POST", "/api/v1/auth/login", { body: { email: "bukan-email", password: "x" }, ip: "10.2.0.3" });
  R.ok("login body invalid -> 400 VALIDATION_ERROR", val.status === 400 && val.json?.error?.code === "VALIDATION_ERROR");

  const expired = await createUser(prisma, `exp${tag}@smoke.test`, PW, { expiresAt: new Date(Date.now() - 86_400_000) });
  const ex = await call("POST", "/api/v1/auth/login", { body: { email: expired.email, password: PW }, ip: "10.2.0.4" });
  R.ok("login akun expired -> 403 ACCOUNT_EXPIRED", ex.status === 403 && ex.json?.error?.code === "ACCOUNT_EXPIRED", JSON.stringify(ex.json));

  const login = await call("POST", "/api/v1/auth/login", { body: { email: u.email, password: PW, deviceName: "Smoke Phone" }, ip: "10.2.0.5" });
  R.ok("login sukses -> 200 + Cache-Control no-store", login.status === 200 && /no-store/.test(login.res.headers.get("cache-control") ?? ""), String(login.status));
  const t1 = R.schema("respons login", TokenResponseSchema, login.json)!;

  const viaBearer = await call("GET", "/api/devices", { token: t1.accessToken });
  R.ok("access token diterima route yang sama dengan web (Bearer, GET /api/devices) -> 200", viaBearer.status === 200 && Array.isArray(viaBearer.json), String(viaBearer.status));
  R.ok("tanpa token -> 401", (await call("GET", "/api/devices")).status === 401);
  R.ok("Bearer sampah -> 401 (bukan 500)", (await call("GET", "/api/devices", { token: "bukan.jwt.valid" })).status === 401);
  R.ok("header Authorization bukan Bearer -> 401", (await call("GET", "/api/devices", { headers: { authorization: "Basic abc" } })).status === 401);
  const forged = await new SignJWT({ tv: 0, sid: "x" }).setProtectedHeader({ alg: "HS256" }).setSubject(u.id).setIssuer("bms-api").setAudience("bms-api").setExpirationTime("15m").sign(new TextEncoder().encode(SMOKE_NEXTAUTH_SECRET.padEnd(40, "0")));
  R.ok("token yang ditandatangani secret lain (NEXTAUTH) -> 401", (await call("GET", "/api/devices", { token: forged })).status === 401);

  const r1 = await call("POST", "/api/v1/auth/refresh", { body: { refreshToken: t1.refreshToken }, ip: "10.2.0.6" });
  R.ok("refresh -> 200 pasangan baru", r1.status === 200 && r1.json?.refreshToken && r1.json.refreshToken !== t1.refreshToken);
  const t2 = R.schema("respons refresh", TokenResponseSchema, r1.json)!;
  R.ok("access token lama tetap berlaku sampai exp (stateless)", (await call("GET", "/api/devices", { token: t1.accessToken })).status === 200);
  const reuse = await call("POST", "/api/v1/auth/refresh", { body: { refreshToken: t1.refreshToken }, ip: "10.2.0.6" });
  R.ok("REUSE refresh token lama -> 401 REFRESH_REUSED", reuse.status === 401 && reuse.json?.error?.code === "REFRESH_REUSED", JSON.stringify(reuse.json));
  const afterReuse = await call("POST", "/api/v1/auth/refresh", { body: { refreshToken: t2.refreshToken }, ip: "10.2.0.6" });
  R.ok("setelah reuse SELURUH family dicabut: token baru pun -> 401 REFRESH_REVOKED", afterReuse.status === 401 && afterReuse.json?.error?.code === "REFRESH_REVOKED", JSON.stringify(afterReuse.json));

  // logout
  const l = await call("POST", "/api/v1/auth/login", { body: { email: u.email, password: PW }, ip: "10.2.0.7" });
  const lt = l.json;
  const out = await call("POST", "/api/v1/auth/logout", { body: { refreshToken: lt.refreshToken }, ip: "10.2.0.7" });
  R.ok("logout -> 204", out.status === 204);
  R.ok("logout idempoten -> 204", (await call("POST", "/api/v1/auth/logout", { body: { refreshToken: lt.refreshToken }, ip: "10.2.0.7" })).status === 204);
  R.ok("refresh setelah logout -> 401 REFRESH_REVOKED", (await call("POST", "/api/v1/auth/refresh", { body: { refreshToken: lt.refreshToken }, ip: "10.2.0.7" })).json?.error?.code === "REFRESH_REVOKED");
  R.ok("refresh token ngawur -> 401 INVALID_REFRESH_TOKEN", (await call("POST", "/api/v1/auth/refresh", { body: { refreshToken: "x".repeat(43) }, ip: "10.2.0.7" })).json?.error?.code === "INVALID_REFRESH_TOKEN");

  // logout-all
  const a = (await call("POST", "/api/v1/auth/login", { body: { email: u.email, password: PW }, ip: "10.2.0.8" })).json;
  const b = (await call("POST", "/api/v1/auth/login", { body: { email: u.email, password: PW }, ip: "10.2.0.8" })).json;
  R.ok("logout-all tanpa token -> 401", (await call("POST", "/api/v1/auth/logout-all")).status === 401);
  R.ok("logout-all -> 204", (await call("POST", "/api/v1/auth/logout-all", { token: a.accessToken })).status === 204);
  R.ok("setelah logout-all: access token perangkat LAIN langsung 401", (await call("GET", "/api/devices", { token: b.accessToken })).status === 401);
  R.ok("setelah logout-all: refresh perangkat lain -> 401", (await call("POST", "/api/v1/auth/refresh", { body: { refreshToken: b.refreshToken }, ip: "10.2.0.8" })).status === 401);
  R.ok("login ulang setelah logout-all bekerja", (await call("POST", "/api/v1/auth/login", { body: { email: u.email, password: PW }, ip: "10.2.0.9" })).status === 200);

  // akun expired di tengah sesi -> ditolak seketika
  const c = (await call("POST", "/api/v1/auth/login", { body: { email: u.email, password: PW }, ip: "10.2.0.10" })).json;
  await prisma.user.update({ where: { id: u.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  R.ok("akun di-expire saat sesi berjalan -> access token ditolak SEKETIKA", (await call("GET", "/api/devices", { token: c.accessToken })).status === 401);
  await prisma.user.update({ where: { id: u.id }, data: { expiresAt: null } });

  // rate limit
  let last;
  for (let i = 0; i < 12; i++) last = await call("POST", "/api/v1/auth/login", { body: { email: `spam${tag}@smoke.test`, password: "x" }, ip: "10.2.9.9" });
  R.ok("login dibatasi -> 429 RATE_LIMITED + Retry-After", last?.status === 429 && last.json?.error?.code === "RATE_LIMITED" && Number(last.res.headers.get("retry-after")) > 0, String(last?.status));
  let rl;
  for (let i = 0; i < 65; i++) rl = await call("POST", "/api/v1/auth/refresh", { body: { refreshToken: "y".repeat(43) }, ip: "10.2.8.8" });
  R.ok("refresh dibatasi (60/15 menit per IP) -> 429", rl?.status === 429, String(rl?.status));
}

async function main() {
  let server: ReturnType<typeof spawnServer> | null = null;
  if (!process.env.SMOKE_BASE_URL) server = spawnServer(dbUrl, PORT);
  try {
    R.ok("server sehat (/api/health 200)", await waitHealth(BASE));
    await authSection();

    // fail-fast: server menolak start tanpa JWT_ACCESS_SECRET (dijalankan terpisah, port lain)
    const bad = spawnSync("npx", ["tsx", "src/server.ts"], {
      env: { ...serverEnv(dbUrl, PORT + 50), JWT_ACCESS_SECRET: "" },
      encoding: "utf8",
      timeout: 60_000,
    });
    R.ok("tanpa JWT_ACCESS_SECRET server menolak start (exit 1) dengan pesan jelas", bad.status === 1 && /JWT_ACCESS_SECRET/.test(bad.stdout + bad.stderr), `status=${bad.status}`);
    R.ok("pesan gagal-start tidak memuat nilai secret apa pun", !/smoke-access-secret|smoke-secret-not-real/.test(bad.stdout + bad.stderr));
  } finally {
    server?.kill("SIGTERM");
    await prisma.$disconnect();
  }
  process.exit(R.done("smoke API v1") ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
