/**
 * Smoke test alur login WEB (cookie Auth.js) — dipakai ulang setiap kali dependency auth/Next di-upgrade.
 *
 *   npm run smoke:web                     # menyalakan Postgres sekali-pakai + server BE sendiri
 *   SMOKE_FE_URL=http://127.0.0.1:3101 …  # opsional: cek juga bahwa cookie BE diterima proxy FE (getToken)
 *   SMOKE_BASE_URL=http://127.0.0.1:4055  # opsional: uji server/container yang sudah jalan (bukan spawn)
 *
 * Wajib TEST_DATABASE_URL (diset oleh scripts/with-test-db.sh) yang menunjuk 127.0.0.1 / DB bms_test*.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const dbUrl = process.env.TEST_DATABASE_URL ?? "";
try {
  const u = new URL(dbUrl);
  if (!["127.0.0.1", "localhost"].includes(u.hostname) || !u.pathname.startsWith("/bms_test")) throw new Error();
} catch {
  console.error("TEST_DATABASE_URL harus 127.0.0.1/localhost dan DB bernama bms_test*. Jalankan lewat scripts/with-test-db.sh");
  process.exit(2);
}

const PORT = Number(process.env.SMOKE_PORT ?? 4100);
const BASE = process.env.SMOKE_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const FE = process.env.SMOKE_FE_URL;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  <- " + extra}`);
};

class Jar {
  c = new Map<string, string>();
  set(res: Response) {
    for (const h of res.headers.getSetCookie()) {
      const [kv] = h.split(";");
      const i = kv.indexOf("=");
      const name = kv.slice(0, i);
      const value = kv.slice(i + 1);
      if (value === "") this.c.delete(name);
      else this.c.set(name, value);
    }
  }
  get header() {
    return [...this.c].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  get hasSession() {
    return [...this.c.keys()].some((k) => k.includes("session-token"));
  }
}

async function call(
  base: string,
  method: string,
  path: string,
  o: { body?: unknown; form?: Record<string, string>; jar?: Jar; ip?: string; headers?: Record<string, string> } = {},
) {
  const h: Record<string, string> = { "x-real-ip": o.ip ?? "198.51.100.1", ...o.headers };
  if (o.jar?.c.size) h.cookie = o.jar.header;
  let payload: string | undefined;
  if (o.body !== undefined) {
    h["content-type"] = "application/json";
    payload = JSON.stringify(o.body);
  }
  if (o.form) {
    h["content-type"] = "application/x-www-form-urlencoded";
    payload = new URLSearchParams(o.form).toString();
  }
  const res = await fetch(base + path, { method, headers: h, body: payload, redirect: "manual" });
  o.jar?.set(res);
  let json: any = null;
  try {
    json = await res.clone().json();
  } catch {}
  return { res, json, status: res.status };
}

async function login(email: string, password: string, ip: string) {
  const jar = new Jar();
  const csrf = await call(BASE, "GET", "/api/auth/csrf", { jar, ip });
  const r = await call(BASE, "POST", "/api/auth/callback/credentials", {
    jar,
    ip,
    form: { csrfToken: csrf.json.csrfToken, email, password, json: "true" },
    headers: { "x-auth-return-redirect": "1" },
  });
  return { jar, r, ok: jar.hasSession, csrfToken: csrf.json.csrfToken as string };
}

async function waitHealth(timeoutMs = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(BASE + "/api/health");
      if (r.status === 200) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function main() {
  let server: ChildProcess | null = null;
  if (!process.env.SMOKE_BASE_URL) {
    server = spawn("npx", ["tsx", "src/server.ts"], {
      env: {
        ...process.env,
        DATABASE_URL: dbUrl,
        NEXTAUTH_SECRET: "smoke-secret-not-real",
        PORT: String(PORT),
        MQTT_BROKER_URL: "mqtt://127.0.0.1:1",
        MQTT_USERNAME: "",
        MQTT_PASSWORD: "",
        GMAIL_USER: "",
        GMAIL_APP_PASSWORD: "",
        APP_URL: "http://localhost:3999",
        JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? "smoke-access-secret-not-real-0123456789",
      },
      stdio: ["ignore", "ignore", "ignore"],
    });
  }
  try {
    ok("server sehat (/api/health 200)", await waitHealth());

    const tag = Date.now();
    const email = `web${tag}@smoke.test`;
    const pw = "correct-horse-battery";
    const reg = await call(BASE, "POST", "/api/auth/register", { body: { name: "Web", email, password: pw }, ip: "10.1.0.1" });
    ok("register -> 202", reg.status === 202, String(reg.status));

    const bad = await login(email, "salah-salah-salah", "10.1.0.2");
    ok("password salah -> tidak ada cookie sesi", !bad.ok);

    const good = await login(email, pw, "10.1.0.3");
    ok("login -> cookie sesi terbit (HttpOnly)", good.ok);

    const session = await call(BASE, "GET", "/api/auth/session", { jar: good.jar });
    ok("GET /api/auth/session berisi user.email", session.json?.user?.email === email, JSON.stringify(session.json));

    const dev = await call(BASE, "GET", "/api/devices", { jar: good.jar });
    ok("route terproteksi dengan cookie -> 200", dev.status === 200 && Array.isArray(dev.json));
    const noCookie = await call(BASE, "GET", "/api/devices");
    ok("tanpa cookie -> 401 (format seragam)", noCookie.status === 401 && noCookie.json?.error?.code === "UNAUTHORIZED");

    if (FE) {
      const home = await call(FE, "GET", "/", { jar: good.jar });
      ok("FE proxy menerima cookie BE (GET / bukan redirect ke /signin)", home.status === 200, `${home.status} ${home.res.headers.get("location")}`);
      const anon = await call(FE, "GET", "/");
      ok("FE proxy tanpa cookie -> redirect /signin", [302, 307, 308].includes(anon.status) && String(anon.res.headers.get("location")).includes("/signin"));
      const viaFe = await call(FE, "GET", "/api/backend/devices", { jar: good.jar });
      ok("lewat rewrite FE /api/backend/devices dengan cookie -> 200", viaFe.status === 200, String(viaFe.status));
    }

    // cabut sesi lewat tokenVersion, dan expiry seketika
    await prisma.user.update({ where: { email }, data: { tokenVersion: { increment: 1 } } });
    const afterBump = await call(BASE, "GET", "/api/devices", { jar: good.jar });
    ok("tokenVersion naik -> sesi lama ditolak 401", afterBump.status === 401, String(afterBump.status));

    const again = await login(email, pw, "10.1.0.4");
    ok("login ulang setelah bump -> sesi baru valid", again.ok && (await call(BASE, "GET", "/api/devices", { jar: again.jar })).status === 200);

    await prisma.user.update({ where: { email }, data: { expiresAt: new Date(Date.now() - 86_400_000) } });
    ok("akun expired -> sesi ditolak seketika", (await call(BASE, "GET", "/api/devices", { jar: again.jar })).status === 401);
    ok("akun expired -> login tidak menghasilkan sesi", !(await login(email, pw, "10.1.0.5")).ok);
    await prisma.user.update({ where: { email }, data: { expiresAt: null } });

    // logout (signout Auth.js)
    const l3 = await login(email, pw, "10.1.0.6");
    const so = await call(BASE, "POST", "/api/auth/signout", {
      jar: l3.jar,
      ip: "10.1.0.6",
      form: { csrfToken: l3.csrfToken, json: "true" },
      headers: { "x-auth-return-redirect": "1" },
    });
    ok("signout -> cookie sesi terhapus", so.status < 400 && !l3.jar.hasSession, `${so.status}`);

    // rate limit login
    let last;
    for (let i = 0; i < 12; i++) {
      last = await call(BASE, "POST", "/api/auth/callback/credentials", {
        ip: "10.9.9.9",
        form: { csrfToken: "x", email: `spam${tag}@smoke.test`, password: "x" },
        headers: { "x-auth-return-redirect": "1" },
      });
    }
    ok("login dibatasi: 429 + ?error=RateLimited", last?.status === 429 && String(last.json?.url).includes("RateLimited"), String(last?.status));
  } finally {
    server?.kill("SIGTERM");
    await prisma.$disconnect();
  }
  console.log(`\nHASIL smoke web auth: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
