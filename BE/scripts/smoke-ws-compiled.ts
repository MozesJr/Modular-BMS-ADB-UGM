/**
 * Smoke test /ws terhadap server HASIL KOMPILASI (`node dist/server.js` + `.next`), sebagai PROSES TERPISAH.
 * Ada karena regresi nyata: custom server memuat `next/server` secara transitif (ws-runtime -> device-access -> http),
 * sehingga request pertama ke route handler Next melempar "AsyncLocalStorage accessed in runtime where it is not
 * available" dan proses crash-loop di produksi. Tes yang meng-impor modul (dengan mock) atau menjalankan `tsx` tidak
 * pernah melihatnya.
 *
 *   npm run build && npm run smoke:ws        # menyalakan Postgres sekali-pakai lewat scripts/with-test-db.sh
 *
 * Yang dicek: 401/403 sebelum handshake, koneksi cookie dan bearer valid, request ke route Next (/api/health,
 * /api/v1/me), pesan MQTT -> bms:update hanya ke pemilik device, lalu >= 3 siklus revalidasi + heartbeat
 * (WS_REVALIDATE_SEC=1, WS_PING_SEC=1): proses masih hidup, koneksi masih terbuka, stderr bersih.
 * Broker MQTT dipalsukan (net server mini) supaya tidak butuh dependency/broker nyata.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
import WebSocket from "ws";
import { signAccessToken } from "../src/lib/tokens";
import { createUser, makeClient, Reporter, requireTestDb, seedDevice, serverEnv, SMOKE_ACCESS_SECRET, SMOKE_NEXTAUTH_SECRET } from "./_smoke-lib";

const dbUrl = requireTestDb();
const root = path.resolve(__dirname, "..");
for (const f of ["dist/server.js", ".next/BUILD_ID"]) {
  if (!existsSync(path.join(root, f))) {
    console.error(`${f} tidak ada. Jalankan "npm run build" dulu (smoke ini menguji hasil kompilasi).`);
    process.exit(2);
  }
}

const PORT = Number(process.env.SMOKE_PORT ?? 4710);
const MQTT_PORT = Number(process.env.SMOKE_MQTT_PORT ?? 4711);
const ORIGIN = "http://smoke.test";
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;
const BASE = `http://127.0.0.1:${PORT}`;
const REVALIDATE_SEC = 1;
const r = new Reporter();
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

// ---- Broker MQTT palsu ---------------------------------------------------------------------
const mqttClients = new Set<net.Socket>();
let subscribed: () => void = () => {};
const subscribedP = new Promise<void>((res) => (subscribed = res));

const mqttServer = net.createServer((sock) => {
  mqttClients.add(sock);
  sock.on("close", () => mqttClients.delete(sock));
  sock.on("error", () => {});
  let buf = Buffer.alloc(0);
  sock.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      let len = 0;
      let mult = 1;
      let i = 1;
      for (;;) {
        if (i >= buf.length) return;
        const b = buf[i++];
        len += (b & 127) * mult;
        mult *= 128;
        if (!(b & 128)) break;
      }
      if (buf.length < i + len) return;
      const type = buf[0] >> 4;
      const body = buf.subarray(i, i + len);
      buf = buf.subarray(i + len);
      if (type === 1) sock.write(Buffer.from([0x20, 0x02, 0x00, 0x00])); // CONNECT -> CONNACK
      else if (type === 8) {
        sock.write(Buffer.from([0x90, 0x03, body[0], body[1], 0x01])); // SUBSCRIBE -> SUBACK (qos1)
        subscribed();
      } else if (type === 12) sock.write(Buffer.from([0xd0, 0x00])); // PINGREQ -> PINGRESP
    }
  });
});

function publish(topic: string, payload: string) {
  const t = Buffer.from(topic);
  const p = Buffer.from(payload);
  const body = Buffer.concat([Buffer.from([t.length >> 8, t.length & 255]), t, p]);
  const rem: number[] = [];
  let n = body.length;
  do {
    let d = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) d |= 128;
    rem.push(d);
  } while (n > 0);
  const packet = Buffer.concat([Buffer.from([0x30, ...rem]), body]);
  for (const s of mqttClients) s.write(packet);
}

// ---- Klien WS ------------------------------------------------------------------------------
type Conn = { ws: WebSocket; messages: string[] } | { status: number };
function connect(headers: Record<string, string>): Promise<Conn> {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL, { headers });
    const messages: string[] = [];
    ws.on("message", (d) => messages.push(d.toString()));
    ws.on("open", () => resolve({ ws, messages }));
    ws.on("unexpected-response", (_q, res) => {
      resolve({ status: res.statusCode ?? 0 });
      res.resume();
    });
    ws.on("error", () => {});
  });
}
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function main() {
  await new Promise<void>((res) => mqttServer.listen(MQTT_PORT, "127.0.0.1", res));

  const stamp = Date.now();
  const userA = await createUser(prisma, `ws-a-${stamp}@example.com`, "x");
  const userB = await createUser(prisma, `ws-b-${stamp}@example.com`, "x");
  const serial = `WS-SMOKE-${stamp}`;
  const device = await seedDevice(prisma, { serial, ownerId: userA.id, receivedAt: new Date(), packs: [{ index: 0, temperature: 25, cells: [3.3] }] });

  const server = spawn("node", ["dist/server.js"], {
    cwd: root,
    env: serverEnv(dbUrl, PORT, {
      NODE_ENV: "production",
      NEXTAUTH_URL: BASE,
      MQTT_BROKER_URL: `mqtt://127.0.0.1:${MQTT_PORT}`,
      WS_ALLOWED_ORIGINS: ORIGIN,
      WS_REVALIDATE_SEC: String(REVALIDATE_SEC),
      WS_PING_SEC: "1",
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  let stdout = "";
  let exited: number | null = null;
  server.stderr.on("data", (d) => (stderr += d.toString()));
  server.stdout.on("data", (d) => (stdout += d.toString()));
  server.on("exit", (code) => (exited = code ?? -1));

  try {
    let healthy = false;
    for (let i = 0; i < 90 && exited === null; i += 1) {
      try {
        if ((await fetch(`${BASE}/api/health`)).status === 200) {
          healthy = true;
          break;
        }
      } catch {}
      await sleep(1000);
    }
    r.ok("server hasil kompilasi start dan /api/health menjawab 200", healthy, stderr.slice(-400));
    if (!healthy) return;
    await Promise.race([subscribedP, sleep(15_000)]);

    const cookieName = "authjs.session-token"; // NEXTAUTH_URL http -> tanpa prefix __Secure-
    const cookieOf = async (id: string) => `${cookieName}=${await encode({ token: { id, tv: 0 }, secret: SMOKE_NEXTAUTH_SECRET, salt: cookieName, maxAge: 3600 })}`;
    const cookieA = await cookieOf(userA.id);
    const cookieB = await cookieOf(userB.id);
    process.env.JWT_ACCESS_SECRET = SMOKE_ACCESS_SECRET; // secret yang sama dengan server yang di-spawn
    const bearerA = await signAccessToken({ userId: userA.id, tokenVersion: 0, familyId: "smoke" });

    // 1) Request ke route handler Next (pemicu crash lama: instance AsyncLocalStorage palsu).
    const call = makeClient(BASE);
    r.ok("GET /api/v1/me dengan cookie -> 200 (route Next + principal tanpa impor Next)", (await call("GET", "/api/v1/me", { headers: { cookie: cookieA } })).status === 200);
    r.ok("GET /api/v1/me dengan bearer -> 200", (await call("GET", "/api/v1/me", { token: bearerA })).status === 200);
    r.ok("GET /api/v1/me tanpa kredensial -> 401", (await call("GET", "/api/v1/me")).status === 401);

    // 2) Handshake
    const none = await connect({});
    r.ok("WS tanpa kredensial -> 401", "status" in none && none.status === 401);
    const noOrigin = await connect({ cookie: cookieA });
    r.ok("WS cookie tanpa Origin -> 403", "status" in noOrigin && noOrigin.status === 403);
    const bad = await connect({ cookie: `${cookieName}=sampah`, origin: ORIGIN });
    r.ok("WS cookie tidak valid -> 401", "status" in bad && bad.status === 401);

    const a = await connect({ cookie: cookieA, origin: ORIGIN });
    const b = await connect({ cookie: cookieB, origin: ORIGIN });
    const aBearer = await connect({ authorization: `Bearer ${bearerA}` });
    r.ok("WS cookie valid (user A) diterima", "ws" in a);
    r.ok("WS cookie valid (user B) diterima", "ws" in b);
    r.ok("WS bearer valid tanpa Origin diterima", "ws" in aBearer);
    if (!("ws" in a) || !("ws" in b) || !("ws" in aBearer)) return;

    // 3) MQTT -> bms:update hanya ke pemilik device
    publish(`bms/${serial}/data`, JSON.stringify({ timestamp: Date.now(), packs: [{ index: 0, temperature: 26, balancerConnected: true, cells: [{ index: 0, voltage: 3.31 }] }] }));
    for (let i = 0; i < 50 && (a.messages.length === 0 || aBearer.messages.length === 0); i += 1) await sleep(100);
    const first = a.messages[0] ? (JSON.parse(a.messages[0]) as { event: string; payload: { id: string } }) : null;
    r.ok("pemilik menerima bms:update untuk device-nya", first?.event === "bms:update" && first.payload.id === device.id, a.messages[0] ?? "tidak ada pesan");
    r.ok("koneksi bearer pemilik juga menerima", aBearer.messages.length >= 1);
    await sleep(300);
    r.ok("user B tidak menerima update device milik A", b.messages.length === 0);

    // 4) Bertahan melewati >= 3 siklus revalidasi + heartbeat
    const t0 = Date.now();
    const cycles = 4;
    while (Date.now() - t0 < (cycles + 0.5) * REVALIDATE_SEC * 1000) {
      await call("GET", "/api/health"); // request route Next berulang selama siklus berjalan
      await sleep(400);
    }
    r.ok(`proses masih hidup setelah >= ${cycles} siklus revalidasi/heartbeat`, exited === null, `exit=${exited}`);
    r.ok("koneksi WS masih terbuka (revalidasi tidak memutus sesi valid)", a.ws.readyState === WebSocket.OPEN && b.ws.readyState === WebSocket.OPEN && aBearer.ws.readyState === WebSocket.OPEN);
    r.ok("/api/health masih 200", (await call("GET", "/api/health")).status === 200);

    // 5) Revalidasi benar-benar bekerja: tokenVersion naik -> koneksi ditutup 4401
    const closed = new Promise<number>((res) => a.ws.on("close", (code) => res(code)));
    await prisma.user.update({ where: { id: userA.id }, data: { tokenVersion: { increment: 1 } } });
    const code = await Promise.race([closed, sleep((REVALIDATE_SEC + 3) * 1000).then(() => -1)]);
    r.ok("tokenVersion naik -> koneksi cookie ditutup 4401 oleh revalidasi", code === 4401, `code=${code}`);
    r.ok("proses masih hidup setelah revalidasi menutup koneksi", exited === null);

    // 6) stderr bersih
    const errLines = stderr.split("\n").filter((l) => /Invariant|AsyncLocalStorage|Unhandled|uncaught|"level":"error"|^\s+at /i.test(l));
    r.ok("stderr tidak berisi error", errLines.length === 0, errLines.slice(0, 3).join(" | "));
    for (const c of [a, b, aBearer]) c.ws.terminate();
  } finally {
    server.kill("SIGTERM");
    await sleep(500);
    if (process.env.SMOKE_VERBOSE) console.log(stdout.slice(-1500), stderr.slice(-1500));
    await prisma.deviceCollaborator.deleteMany({ where: { deviceId: device.id } });
    await prisma.device.delete({ where: { id: device.id } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  }
}

main()
  .catch((e) => {
    console.error(e);
    r.ok("smoke tidak melempar", false, String(e));
  })
  .finally(async () => {
    mqttServer.close();
    for (const s of mqttClients) s.destroy();
    await prisma.$disconnect();
    process.exit(r.done("smoke /ws (server terkompilasi)") ? 0 : 1);
  });
