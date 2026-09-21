/**
 * Smoke test API v1 end-to-end terhadap Postgres SEKALI-PAKAI:  npm run smoke:api
 * (menyalakan DB sekali-pakai + server BE sendiri; tidak menyentuh DB/server lain)
 * Bagian: auth token (B2) · me/devices/dashboard (B3) · history (B4) · collaborator & manajemen device (B5).
 */
import { PrismaClient } from "@prisma/client";
import { createUser, makeClient, Reporter, requireTestDb, seedDevice, spawnServer, waitHealth, serverEnv, SMOKE_NEXTAUTH_SECRET } from "./_smoke-lib";
import { spawnSync } from "node:child_process";
import {
  TokenResponseSchema, ErrorResponseSchema, MeSchema, CollaboratorListSchema, DeviceListResponseSchema, DeviceDetailSchema, DashboardSummarySchema, HistoryResponseSchema,
} from "../src/contracts/schemas";
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

async function loginToken(email: string, ip: string): Promise<string> {
  const r = await call("POST", "/api/v1/auth/login", { body: { email, password: PW }, ip });
  return r.json.accessToken as string;
}

async function readSection() {
  const owner = await createUser(prisma, `own${tag}@smoke.test`, PW, { name: "Pemilik" });
  const viewer = await createUser(prisma, `view${tag}@smoke.test`, PW, { name: "Pelihat" });
  const stranger = await createUser(prisma, `str${tag}@smoke.test`, PW);
  const now = new Date();

  // 3 device milik owner: A online (2 pack), B offline (data 1 jam lalu), C tanpa data; collaborator viewer di A
  const A = await seedDevice(prisma, { serial: `SM-A-${tag}`, ownerId: owner.id, name: "Rak A", receivedAt: now, packs: [
    { index: 0, temperature: 27.5, current: -2.5, power: -120, cells: [3.30, 3.32, 3.31, 3.29] },
    { index: 1, temperature: null, current: 1.0, power: 50, cells: [3.20, 3.25] },
  ] });
  await new Promise((r) => setTimeout(r, 15));
  const B = await seedDevice(prisma, { serial: `SM-B-${tag}`, ownerId: owner.id, name: "Rak B", receivedAt: new Date(now.getTime() - 3600_000), packs: [{ index: 0, temperature: 30, power: 10, cells: [3.3, 3.3] }] });
  await new Promise((r) => setTimeout(r, 15));
  const C = await seedDevice(prisma, { serial: `SM-C-${tag}`, ownerId: owner.id, verified: false, receivedAt: now, packs: [] });
  await prisma.deviceCollaborator.create({ data: { deviceId: A.id, userId: viewer.id, role: "viewer" } });

  const ot = await loginToken(owner.email, "10.3.0.1");
  const vt = await loginToken(viewer.email, "10.3.0.2");
  const st = await loginToken(stranger.email, "10.3.0.3");

  // /me
  const me = await call("GET", "/api/v1/me", { token: ot });
  R.ok("GET /me -> 200", me.status === 200);
  R.schema("respons /me", MeSchema, me.json);
  R.ok("/me tanpa token -> 401", (await call("GET", "/api/v1/me")).status === 401);

  // list
  const list = await call("GET", "/api/v1/devices", { token: ot });
  const l = R.schema("daftar device (view=summary)", DeviceListResponseSchema, list.json);
  R.ok("owner melihat 3 device, terbaru dulu (C, B, A)", l?.items.map((d) => d.serialNumber).join() === `SM-C-${tag},SM-B-${tag},SM-A-${tag}`, JSON.stringify(l?.items.map((d) => d.serialNumber)));
  const a = l?.items.find((d) => d.id === A.id);
  R.ok("device A: online, role owner, packCount 2, lastSeenAt terisi", a?.online === true && a.role === "owner" && a.packCount === 2 && !!a.lastSeenAt);
  R.ok("device B (data 1 jam lalu): offline", l?.items.find((d) => d.id === B.id)?.online === false);
  R.ok("device C (tanpa data): offline, lastSeenAt null, summary kosong", (() => { const c = l?.items.find((d) => d.id === C.id); return c?.online === false && c.lastSeenAt === null && c.summary?.packs.length === 0; })());
  const p0 = a?.summary?.packs.find((p) => p.index === 0);
  R.ok("ringkasan pack 0: tegangan 13.22 V, delta 30 mV, arus -2.5 A, daya -120 W, suhu 27.5", p0?.voltageV === 13.22 && p0.cellDeltaMv === 30 && p0.currentA === -2.5 && p0.powerW === -120 && p0.temperatureC === 27.5, JSON.stringify(p0));
  R.ok("pack 1: suhu null (sensor error) tetap null, bukan 0", a?.summary?.packs.find((p) => p.index === 1)?.temperatureC === null);
  R.ok("ringkasan device: suhu maks 27.5, daya total -70, delta maks 50", a?.summary?.maxTemperatureC === 27.5 && a.summary.totalPowerW === -70 && a.summary.maxCellDeltaMv === 50, JSON.stringify(a?.summary));
  R.ok("respons tidak memuat SoC/SoH", !/soc|soh|stateOf/i.test(JSON.stringify(list.json)));

  const basic = await call("GET", "/api/v1/devices?view=basic", { token: ot });
  R.ok("view=basic tanpa summary", basic.status === 200 && basic.json.items.every((d: any) => d.summary === undefined) && basic.json.items.length === 3);

  // pagination
  const p1 = await call("GET", "/api/v1/devices?limit=2", { token: ot });
  R.ok("limit=2 -> 2 item + nextCursor", p1.json.items.length === 2 && typeof p1.json.nextCursor === "string");
  const p2 = await call("GET", `/api/v1/devices?limit=2&cursor=${encodeURIComponent(p1.json.nextCursor)}`, { token: ot });
  R.ok("halaman 2 -> sisa 1 item, nextCursor null, tanpa duplikat", p2.json.items.length === 1 && p2.json.nextCursor === null && ![...p1.json.items].some((x: any) => x.id === p2.json.items[0].id));
  R.ok("cursor rusak -> 400 INVALID_CURSOR", (await call("GET", "/api/v1/devices?cursor=ngawur", { token: ot })).json?.error?.code === "INVALID_CURSOR");
  R.ok("limit di luar batas -> 400", (await call("GET", "/api/v1/devices?limit=1000", { token: ot })).status === 400);

  // akses
  const vList = await call("GET", "/api/v1/devices", { token: vt });
  R.ok("viewer hanya melihat device A dengan role viewer", vList.json.items.length === 1 && vList.json.items[0].id === A.id && vList.json.items[0].role === "viewer");
  R.ok("orang asing: daftar kosong", (await call("GET", "/api/v1/devices", { token: st })).json.items.length === 0);

  // detail
  const det = await call("GET", `/api/v1/devices/${A.id}`, { token: ot });
  const dd = R.schema("detail device", DeviceDetailSchema, det.json);
  R.ok("detail: 2 pack, cell terurut & bersatuan V, collaborator terlihat oleh owner DENGAN email", dd?.packs.length === 2 && dd.packs[0].cells[0].voltageV === 3.3 && dd.collaborators.length === 1 && dd.collaborators[0].email === viewer.email);
  const vdet = await call("GET", `/api/v1/devices/${A.id}`, { token: vt });
  R.ok("detail oleh viewer: 200, role viewer, EMAIL collaborator disembunyikan (null)", vdet.status === 200 && vdet.json.role === "viewer" && vdet.json.collaborators.every((c: any) => c.email === null) && !JSON.stringify(vdet.json).includes(viewer.email));
  const sdet = await call("GET", `/api/v1/devices/${A.id}`, { token: st });
  R.ok("orang asing -> 404 DEVICE_NOT_FOUND (bukan 403: keberadaan tidak bocor)", sdet.status === 404 && sdet.json?.error?.code === "DEVICE_NOT_FOUND");
  R.ok("id tidak ada -> 404 dengan respons identik", (await call("GET", "/api/v1/devices/tidak-ada", { token: ot })).json?.error?.message === sdet.json?.error?.message);
  R.ok("viewer tidak melihat device B milik owner (404)", (await call("GET", `/api/v1/devices/${B.id}`, { token: vt })).status === 404);

  // ETag
  const etag = det.res.headers.get("etag")!;
  R.ok("detail membawa ETag + Cache-Control private,no-cache", !!etag && det.res.headers.get("cache-control") === "private, no-cache");
  const nm = await call("GET", `/api/v1/devices/${A.id}`, { token: ot, headers: { "if-none-match": etag } });
  R.ok("If-None-Match sama -> 304 tanpa body", nm.status === 304 && nm.json === null);
  await prisma.pack.updateMany({ where: { deviceId: A.id, index: 0 }, data: { temperature: 28.1 } });
  R.ok("data berubah -> 200 dengan ETag baru", (await call("GET", `/api/v1/devices/${A.id}`, { token: ot, headers: { "if-none-match": etag } })).status === 200);

  // dashboard
  const dash = await call("GET", "/api/v1/dashboard/summary", { token: ot });
  const ds = R.schema("dashboard summary", DashboardSummarySchema, dash.json);
  R.ok("dashboard: 3 device, 1 online (A), 2 offline, 1 menunggu verifikasi (C)", ds?.deviceCount === 3 && ds.onlineCount === 1 && ds.offlineCount === 2 && ds.pendingVerificationCount === 1, JSON.stringify(ds));
  R.ok("dashboard: daya total hanya dari device online (-70), suhu maks 28.1, delta maks 50", ds?.totalPowerW === -70 && ds.maxTemperatureC === 28.1 && ds.maxCellDeltaMv === 50, JSON.stringify(ds));
  const dashNm = await call("GET", "/api/v1/dashboard/summary", { token: ot, headers: { "if-none-match": dash.res.headers.get("etag")! } });
  R.ok("dashboard: If-None-Match -> 304 walau generatedAt berbeda", dashNm.status === 304);
  const empty = await call("GET", "/api/v1/dashboard/summary", { token: st });
  R.ok("dashboard user tanpa device: nol dan null (bukan 0)", empty.json.deviceCount === 0 && empty.json.totalPowerW === null && empty.json.maxTemperatureC === null);
  return { owner, viewer, stranger, A, B, C, ot, vt, st };
}

async function historySection(ctx: Awaited<ReturnType<typeof readSection>>) {
  const { A, ot, vt, st } = ctx;
  // 3 jam data per menit (2 pack) + cell pack 0, berakhir 5 menit lalu
  const end = Date.now() - 5 * 60_000;
  const packRows: { deviceId: string; packIndex: number; recordedAt: Date; temperature: number | null; current: number | null; power: number | null; balancerConnected: boolean }[] = [];
  const cellRows: { deviceId: string; packIndex: number; cellIndex: number; recordedAt: Date; voltage: number }[] = [];
  for (let k = 0; k < 180; k++) {
    const recordedAt = new Date(Math.floor((end - k * 60_000) / 60_000) * 60_000);
    for (const packIndex of [0, 1]) packRows.push({ deviceId: A.id, packIndex, recordedAt, temperature: packIndex === 1 && k % 10 === 0 ? null : 25 + (k % 5), current: -2, power: -100 - k, balancerConnected: true });
    for (const cellIndex of [0, 1, 2, 3]) cellRows.push({ deviceId: A.id, packIndex: 0, cellIndex, recordedAt, voltage: 3.3 + cellIndex * 0.01 });
  }
  await prisma.packHistory.createMany({ data: packRows });
  await prisma.cellHistory.createMany({ data: cellRows });

  const q = (path: string, token = ot, headers: Record<string, string> = {}) => call("GET", `/api/v1/devices/${A.id}/history${path}`, { token, headers });

  const def = await q("");
  const h = R.schema("history default (5m, 24 jam)", HistoryResponseSchema, def.json);
  R.ok("default: bucket 5m dan 6 seri (2 pack × temperature/current/power)", !!h && h.bucket === "5m" && h.series.length === 6, JSON.stringify(h?.series.map((s) => `${s.packIndex}${s.metric}`)));
  const pw = h?.series.find((s) => s.packIndex === 0 && s.metric === "power");
  R.ok("power pack0: unit W, titik naik waktu, v/min/max terisi", pw?.unit === "W" && pw.points.length > 20 && pw.points.every((p, i, a) => i === 0 || a[i - 1].t < p.t) && pw.points[0].min !== null && pw.points[0].max !== null);
  R.ok("suhu null (pack1) tidak menghasilkan titik null", h?.series.filter((s) => s.metric === "temperature").every((s) => s.points.every((p) => typeof p.v === "number")) === true);

  const raw = await q("?bucket=raw&metrics=power&packIndex=0&limit=50");
  R.schema("history raw", HistoryResponseSchema, raw.json);
  R.ok("raw: 50 titik + nextCursor", raw.json.series[0].points.length === 50 && typeof raw.json.nextCursor === "string" && raw.json.series[0].points[0].min === null);
  const raw2 = await q(`?bucket=raw&metrics=power&packIndex=0&limit=50&cursor=${encodeURIComponent(raw.json.nextCursor)}`);
  R.ok("raw halaman 2 dimulai setelah halaman 1 (tanpa tumpang tindih)", raw2.json.series[0].points[0].t > raw.json.series[0].points[49].t);

  const volt = await q("?bucket=1m&metrics=voltage&packIndex=0&from=" + encodeURIComponent(new Date(end - 30 * 60_000).toISOString()));
  R.ok("voltage 1m: 4 seri cell, satuan V", volt.status === 200 && volt.json.series.length === 4 && volt.json.series.every((s: any) => s.scope === "cell" && s.unit === "V"), String(volt.status));

  R.ok("metric tidak dikenal (soc) -> 400 dengan path metrics", (await q("?metrics=soc")).json?.error?.details?.[0]?.path === "metrics");
  R.ok("raw > 48 jam -> 400", (await q("?bucket=raw&from=" + encodeURIComponent(new Date(Date.now() - 5 * 86_400_000).toISOString()))).status === 400);
  R.ok("raw campur voltage + power -> 400", (await q("?bucket=raw&metrics=voltage,power")).status === 400);
  R.ok("from >= to -> 400", (await q("?from=2026-09-21T10:00:00Z&to=2026-09-21T09:00:00Z")).status === 400);
  const big = await q("?bucket=1m&metrics=voltage&from=" + encodeURIComponent(new Date(Date.now() - 30 * 86_400_000).toISOString()));
  R.ok("rentang terlalu besar -> 400 dengan saran bucket & batas titik", big.status === 400 && /bucket=5m/.test(JSON.stringify(big.json)) && /20000/.test(JSON.stringify(big.json)), JSON.stringify(big.json).slice(0, 200));
  R.ok("bucket tidak valid -> 400", (await q("?bucket=1d")).status === 400);

  R.ok("viewer (collaborator) boleh membaca riwayat", (await q("", vt)).status === 200);
  R.ok("orang asing -> 404 DEVICE_NOT_FOUND", (await q("", st)).json?.error?.code === "DEVICE_NOT_FOUND");
  R.ok("tanpa token -> 401", (await call("GET", `/api/v1/devices/${A.id}/history`)).status === 401);

  const etag = def.res.headers.get("etag")!;
  R.ok("history mendukung ETag: If-None-Match sama -> 304", (await q("", ot, { "if-none-match": etag })).status === 304);
}

async function manageSection() {
  const owner = await createUser(prisma, `mo${tag}@smoke.test`, PW, { name: "Owner M" });
  const editor = await createUser(prisma, `me${tag}@smoke.test`, PW, { name: "Editor M" });
  const viewer = await createUser(prisma, `mv${tag}@smoke.test`, PW, { name: "Viewer M" });
  const other = await createUser(prisma, `mx${tag}@smoke.test`, PW, { name: "Other M" });
  const ot = await loginToken(owner.email, "10.4.0.1");
  const et = await loginToken(editor.email, "10.4.0.2");
  const vt = await loginToken(viewer.email, "10.4.0.3");
  const xt = await loginToken(other.email, "10.4.0.4");

  // ---- klaim ----
  const serial = `MG-${tag}`;
  const bad = await call("POST", "/api/v1/devices", { token: ot, body: { serialNumber: "bad/serial" } });
  R.ok("klaim serial tak aman -> 400 VALIDATION_ERROR", bad.status === 400 && bad.json?.error?.code === "VALIDATION_ERROR");
  const c1 = await call("POST", "/api/v1/devices", { token: ot, body: { serialNumber: serial, name: "Unit M" } });
  const dev = R.schema("klaim device baru", DeviceDetailSchema, c1.json);
  R.ok("klaim baru -> 201, role owner, verified=false, nama tersimpan", c1.status === 201 && dev?.role === "owner" && dev.verified === false && dev.name === "Unit M");
  R.ok("klaim serial yang sudah dimiliki orang lain -> 409 DEVICE_ALREADY_CLAIMED", (await call("POST", "/api/v1/devices", { token: xt, body: { serialNumber: serial } })).json?.error?.code === "DEVICE_ALREADY_CLAIMED");
  const devId = dev!.id;

  // device auto-provision (tanpa owner) yang sudah punya data -> klaim membawa data
  const auto = await seedDevice(prisma, { serial: `AUTO-${tag}`, ownerId: null, receivedAt: new Date(), packs: [{ index: 0, temperature: 25, power: 5, cells: [3.3, 3.31] }] });
  const c2 = await call("POST", "/api/v1/devices", { token: xt, body: { serialNumber: `AUTO-${tag}`, name: "Diklaim" } });
  R.ok("klaim device auto-provision -> 201 dengan pack/riwayat ikut", c2.status === 201 && c2.json.id === auto.id && c2.json.packs.length === 1 && c2.json.online === true);

  // ---- collaborator: undang ----
  const add = (token: string, body: unknown) => call("POST", `/api/v1/devices/${devId}/collaborators`, { token, body });
  const a1 = await add(ot, { email: editor.email, role: "editor" });
  R.ok("owner mengundang editor -> 201, email terlihat", a1.status === 201 && a1.json.role === "editor" && a1.json.email === editor.email);
  const a2 = await add(ot, { email: viewer.email });
  R.ok("undang tanpa role -> default viewer", a2.status === 201 && a2.json.role === "viewer");
  R.ok("undang duplikat -> 409 ALREADY_COLLABORATOR", (await add(ot, { email: viewer.email })).json?.error?.code === "ALREADY_COLLABORATOR");
  R.ok("undang diri sendiri -> 400", (await add(ot, { email: owner.email })).status === 400);
  R.ok("undang email tak terdaftar -> 404 USER_NOT_FOUND", (await add(ot, { email: `ghost${tag}@smoke.test` })).json?.error?.code === "USER_NOT_FOUND");
  R.ok("role tidak valid -> 400", (await add(ot, { email: other.email, role: "owner" })).status === 400);
  R.ok("editor TIDAK boleh mengundang -> 403", (await add(et, { email: other.email })).status === 403);
  R.ok("viewer TIDAK boleh mengundang -> 403", (await add(vt, { email: other.email })).status === 403);
  R.ok("orang asing mengundang -> 404 (device tidak bocor)", (await add(xt, { email: other.email })).status === 404);

  // ---- collaborator: daftar (email hanya untuk owner) ----
  const listO = await call("GET", `/api/v1/devices/${devId}/collaborators`, { token: ot });
  R.schema("daftar collaborator (owner)", CollaboratorListSchema, listO.json);
  R.ok("owner: 2 collaborator DENGAN email", listO.json.items.length === 2 && listO.json.items.every((c: any) => typeof c.email === "string"));
  const listE = await call("GET", `/api/v1/devices/${devId}/collaborators`, { token: et });
  R.ok("editor: melihat daftar tetapi SEMUA email null", listE.status === 200 && listE.json.items.length === 2 && listE.json.items.every((c: any) => c.email === null) && !JSON.stringify(listE.json).includes(viewer.email));
  R.ok("orang asing -> 404", (await call("GET", `/api/v1/devices/${devId}/collaborators`, { token: xt })).status === 404);

  // ---- ubah nama: owner/editor boleh, viewer tidak ----
  const rn = (token: string, name: string) => call("PATCH", `/api/v1/devices/${devId}`, { token, body: { name } });
  R.ok("editor mengubah nama -> 200", (await rn(et, "Nama dari Editor")).json?.name === "Nama dari Editor");
  R.ok("owner mengubah nama -> 200", (await rn(ot, "Nama dari Owner")).status === 200);
  R.ok("viewer mengubah nama -> 403", (await rn(vt, "x")).status === 403);
  R.ok("orang asing mengubah nama -> 404", (await rn(xt, "x")).status === 404);
  R.ok("nama kosong -> 400", (await rn(ot, "   ")).status === 400);

  // ---- ubah peran ----
  const setRole = (token: string, userId: string, role: string) => call("PATCH", `/api/v1/devices/${devId}/collaborators/${userId}`, { token, body: { role } });
  R.ok("owner: viewer -> editor", (await setRole(ot, viewer.id, "editor")).json?.role === "editor");
  R.ok("viewer yang naik jadi editor kini boleh ubah nama", (await rn(vt, "Diubah bekas viewer")).status === 200);
  R.ok("editor tidak boleh mengubah peran -> 403", (await setRole(et, viewer.id, "viewer")).status === 403);
  R.ok("ubah peran user yang bukan collaborator -> 404 COLLABORATOR_NOT_FOUND", (await setRole(ot, other.id, "viewer")).json?.error?.code === "COLLABORATOR_NOT_FOUND");
  await setRole(ot, viewer.id, "viewer");

  // ---- cabut / keluar ----
  const del = (token: string, userId: string) => call("DELETE", `/api/v1/devices/${devId}/collaborators/${userId}`, { token });
  R.ok("viewer mencabut collaborator lain -> 403", (await del(vt, editor.id)).status === 403);
  R.ok("viewer KELUAR sendiri -> 204", (await del(vt, viewer.id)).status === 204);
  R.ok("setelah keluar viewer tak lagi punya akses -> 404", (await call("GET", `/api/v1/devices/${devId}`, { token: vt })).status === 404);
  R.ok("keluar lagi -> 404 COLLABORATOR_NOT_FOUND", (await del(vt, viewer.id)).status === 404);
  R.ok("owner mencabut editor -> 204", (await del(ot, editor.id)).status === 204);

  // ---- unclaim ----
  await call("POST", `/api/v1/devices/${devId}/collaborators`, { token: ot, body: { email: editor.email } });
  R.ok("editor mencoba unclaim -> 403", (await call("DELETE", `/api/v1/devices/${devId}`, { token: et })).status === 403);
  R.ok("owner unclaim (default) -> 204", (await call("DELETE", `/api/v1/devices/${devId}`, { token: ot })).status === 204);
  const afterUnclaim = await prisma.device.findUnique({ where: { id: devId }, include: { collaborators: true } });
  R.ok("unclaim: owner null, nama null, verified false, collaborator dilepas, device & data tetap ada", afterUnclaim?.ownerId === null && afterUnclaim.name === null && afterUnclaim.verified === false && afterUnclaim.collaborators.length === 0);
  R.ok("owner lama tidak lagi punya akses -> 404", (await call("GET", `/api/v1/devices/${devId}`, { token: ot })).status === 404);
  const reclaim = await call("POST", "/api/v1/devices", { token: xt, body: { serialNumber: serial } });
  R.ok("device yang di-unclaim bisa diklaim user lain", reclaim.status === 201 && reclaim.json.role === "owner");

  // ---- hapus permanen ----
  await prisma.packHistory.create({ data: { deviceId: devId, packIndex: 0, recordedAt: new Date(), temperature: 20, balancerConnected: true } });
  R.ok("hapus tanpa confirmSerial -> 400", (await call("DELETE", `/api/v1/devices/${devId}?mode=delete`, { token: xt })).status === 400);
  R.ok("hapus dengan confirmSerial salah -> 400", (await call("DELETE", `/api/v1/devices/${devId}?mode=delete&confirmSerial=salah`, { token: xt })).status === 400);
  R.ok("hapus oleh non-owner -> 404/403 (bukan 204)", [403, 404].includes((await call("DELETE", `/api/v1/devices/${devId}?mode=delete&confirmSerial=${serial}`, { token: ot })).status));
  R.ok("owner menghapus permanen dengan konfirmasi -> 204", (await call("DELETE", `/api/v1/devices/${devId}?mode=delete&confirmSerial=${serial}`, { token: xt })).status === 204);
  R.ok("device dan riwayatnya terhapus (cascade)", (await prisma.device.count({ where: { id: devId } })) === 0 && (await prisma.packHistory.count({ where: { deviceId: devId } })) === 0);

  // ---- batas klaim ----
  const spammer = await createUser(prisma, `sp${tag}@smoke.test`, PW);
  const st = await loginToken(spammer.email, "10.4.0.9");
  let last;
  for (let i = 0; i < 22; i++) last = await call("POST", "/api/v1/devices", { token: st, body: { serialNumber: `SPAM-${tag}-${i}` } });
  R.ok("klaim dibatasi 20/jam per user -> 429", last?.status === 429 && last.json?.error?.code === "RATE_LIMITED", String(last?.status));
}

async function main() {
  let server: ReturnType<typeof spawnServer> | null = null;
  if (!process.env.SMOKE_BASE_URL) server = spawnServer(dbUrl, PORT);
  try {
    R.ok("server sehat (/api/health 200)", await waitHealth(BASE));
    await authSection();
    const ctx = await readSection();
    await historySection(ctx);
    await manageSection();

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
