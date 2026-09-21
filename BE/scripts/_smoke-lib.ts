// Pembantu bersama untuk smoke test HTTP (dijalankan lewat scripts/with-test-db.sh).
import { spawn, type ChildProcess } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import type { ZodType } from "zod";

export function requireTestDb(): string {
  const dbUrl = process.env.TEST_DATABASE_URL ?? "";
  try {
    const u = new URL(dbUrl);
    if (!["127.0.0.1", "localhost"].includes(u.hostname) || !u.pathname.startsWith("/bms_test")) throw new Error();
  } catch {
    console.error("TEST_DATABASE_URL harus 127.0.0.1/localhost dan DB bernama bms_test*. Jalankan lewat scripts/with-test-db.sh");
    process.exit(2);
  }
  return dbUrl;
}

export const SMOKE_ACCESS_SECRET = "smoke-access-secret-not-real-0123456789";
export const SMOKE_NEXTAUTH_SECRET = "smoke-secret-not-real";

export function serverEnv(dbUrl: string, port: number, extra: Record<string, string> = {}) {
  return {
    ...process.env,
    DATABASE_URL: dbUrl,
    NEXTAUTH_SECRET: SMOKE_NEXTAUTH_SECRET,
    JWT_ACCESS_SECRET: SMOKE_ACCESS_SECRET,
    PORT: String(port),
    MQTT_BROKER_URL: "mqtt://127.0.0.1:1",
    MQTT_USERNAME: "",
    MQTT_PASSWORD: "",
    GMAIL_USER: "",
    GMAIL_APP_PASSWORD: "",
    APP_URL: "http://localhost:3999",
    ...extra,
  };
}

export function spawnServer(dbUrl: string, port: number, extra: Record<string, string> = {}): ChildProcess {
  return spawn("npx", ["tsx", "src/server.ts"], { env: serverEnv(dbUrl, port, extra), stdio: ["ignore", "ignore", "ignore"] });
}

export async function waitHealth(base: string, timeoutMs = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if ((await fetch(base + "/api/health")).status === 200) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

export class Reporter {
  pass = 0;
  fail = 0;
  ok(name: string, cond: boolean, extra = "") {
    cond ? this.pass++ : this.fail++;
    console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  <- " + extra}`);
  }
  schema<T>(name: string, schema: ZodType<T>, value: unknown) {
    const r = schema.safeParse(value);
    this.ok(`${name} sesuai skema kontrak`, r.success, r.success ? "" : JSON.stringify(r.error.issues.slice(0, 3)));
    return r.success ? r.data : null;
  }
  done(label: string) {
    console.log(`\nHASIL ${label}: ${this.pass} pass, ${this.fail} fail`);
    return this.fail === 0;
  }
}

export interface CallOpts {
  body?: unknown;
  token?: string;
  ip?: string;
  headers?: Record<string, string>;
}

export function makeClient(base: string) {
  return async function call(method: string, path: string, o: CallOpts = {}) {
    const h: Record<string, string> = { "x-real-ip": o.ip ?? "198.51.100.1", ...o.headers };
    if (o.token) h.authorization = `Bearer ${o.token}`;
    let payload: string | undefined;
    if (o.body !== undefined) {
      h["content-type"] = "application/json";
      payload = JSON.stringify(o.body);
    }
    const res = await fetch(base + path, { method, headers: h, body: payload, redirect: "manual" });
    let json: any = null;
    try {
      json = await res.clone().json();
    } catch {}
    return { res, json, status: res.status };
  };
}

export async function createUser(prisma: PrismaClient, email: string, password: string, over: Record<string, unknown> = {}) {
  return prisma.user.create({
    data: { email, name: email.split("@")[0], passwordHash: await bcrypt.hash(password, 4), ...over },
  });
}
