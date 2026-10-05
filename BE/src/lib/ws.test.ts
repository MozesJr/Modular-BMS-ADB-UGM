import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import type { DbUserForSession } from "./session-check";
import type { WsAuthDeps } from "./ws-auth";
import { WS_CLOSE_UNAUTHENTICATED, WsHub } from "./ws-hub";
import { createUpgradeHandler } from "./ws-upgrade";

// Tes dengan server HTTP + WebSocket NYATA; hanya akses DB dan verifikasi kredensial yang di-fake.
const ORIGIN = "http://app.test";

class FakeDb {
  members = new Map<string, Set<string>>();
  users = new Map<string, DbUserForSession>();
  memberLoads = 0;
  gate: Promise<void> | null = null; // bila diset, loadMembers menunggu gate ini SETELAH membaca data
  failLoads = false;

  addUser(id: string, tokenVersion = 0, expiresAt: Date | null = null) {
    this.users.set(id, { id, role: "USER", expiresAt, tokenVersion });
  }
}

type Connected = { ws: WebSocket; messages: string[] };
type Rejected = { status: number };

interface Harness {
  db: FakeDb;
  hub: WsHub;
  server: Server;
  url: string;
  sockets: WebSocket[];
  connect(headers: Record<string, string>, opts?: { autoPong?: boolean }): Promise<Connected | Rejected>;
  stop(): Promise<void>;
}

async function waitFor(cond: () => boolean, ms = 2000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

function fakeAuth(db: FakeDb, over: Partial<WsAuthDeps> = {}): WsAuthDeps {
  return {
    allowedOrigins: new Set([ORIGIN]),
    verifyBearer: async (t) => (t.startsWith("bearer-") ? { userId: t.slice(7), tokenVersion: 0, expSec: null } : null),
    verifyCookie: async (v) =>
      v.startsWith("cookie-")
        ? { userId: v.slice(7), tokenVersion: 0, expSec: null, idleDeadlineSec: Math.floor(Date.now() / 1000) + 3600, sessionId: `sid-${v.slice(7)}` }
        : null,
    loadUser: async (id) => db.users.get(id) ?? null,
    ...over,
  };
}

async function setup(
  over: { maxConnPerUser?: number; pingMs?: number; revalidateMs?: number; ttlMs?: number; auth?: (db: FakeDb) => Partial<WsAuthDeps> } = {},
): Promise<Harness> {
  const db = new FakeDb();
  const hub = new WsHub(
    {
      maxConnPerUser: over.maxConnPerUser ?? 5,
      membershipTtlMs: over.ttlMs ?? 60_000,
      pingMs: over.pingMs ?? 60_000,
      revalidateMs: over.revalidateMs ?? 60_000,
    },
    {
      loadMembers: async (deviceId) => {
        db.memberLoads += 1;
        if (db.failLoads) throw new Error("db down");
        const snapshot = new Set(db.members.get(deviceId) ?? []);
        if (db.gate) await db.gate;
        return snapshot;
      },
      loadUsers: async (ids) => ids.flatMap((id) => (db.users.has(id) ? [db.users.get(id)!] : [])),
    },
  );
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const server = createServer();
  server.on("upgrade", createUpgradeHandler(wss, hub, fakeAuth(db, over.auth?.(db))));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
  const sockets: WebSocket[] = [];
  hub.start();

  const connect: Harness["connect"] = (headers, opts = {}) =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { headers, autoPong: opts.autoPong ?? true });
      const messages: string[] = [];
      sockets.push(ws);
      ws.on("message", (d) => messages.push(d.toString()));
      ws.on("open", () => resolve({ ws, messages }));
      ws.on("unexpected-response", (_req, res) => {
        resolve({ status: res.statusCode ?? 0 });
        res.resume();
      });
      ws.on("error", (e) => {
        if (!/Unexpected server response/.test(e.message)) reject(e);
      });
    });

  const stop = async () => {
    hub.closeAll(1001, "test over");
    for (const s of sockets) s.terminate();
    await new Promise((r) => server.close(r));
  };

  return { db, hub, server, url, sockets, connect, stop };
}

const cookieFor = (id: string) => ({ cookie: `authjs.session-token=cookie-${id}`, origin: ORIGIN });
const bearerFor = (id: string) => ({ authorization: `Bearer bearer-${id}` });
const update = (deviceId: string, seq = 0) => ({ id: deviceId, serialNumber: "S", timestamp: 1, receivedAt: 1, packs: [], seq });
const seqs = (messages: string[]) => messages.map((m) => (JSON.parse(m) as { payload: { seq: number } }).payload.seq);
const asConn = (r: Connected | Rejected): Connected => {
  if (!("ws" in r)) throw new Error(`koneksi ditolak: ${r.status}`);
  return r;
};
const closeCode = (c: Connected) => new Promise<number>((r) => c.ws.on("close", (code) => r(code)));

let h: Harness;
beforeEach(async () => {
  h = await setup();
  h.db.addUser("A");
  h.db.addUser("B");
  h.db.addUser("C");
  h.db.members.set("devA", new Set(["A"]));
  h.db.members.set("devB", new Set(["B"]));
});
afterEach(() => h.stop());

describe("handshake: autentikasi dan Origin", () => {
  it("tanpa kredensial -> 401", async () => {
    expect(await h.connect({})).toEqual({ status: 401 });
    expect(await h.connect({ origin: ORIGIN })).toEqual({ status: 401 });
  });
  it("kredensial tidak valid -> 401 (cookie, bearer, dan format Authorization salah)", async () => {
    expect(await h.connect({ cookie: "authjs.session-token=sampah", origin: ORIGIN })).toEqual({ status: 401 });
    expect(await h.connect({ authorization: "Bearer sampah" })).toEqual({ status: 401 });
    // Authorization rusak TIDAK jatuh ke cookie yang valid
    expect(await h.connect({ authorization: "Basic xxx", ...cookieFor("A") })).toEqual({ status: 401 });
  });
  it("user sudah tidak ada atau tokenVersion berbeda -> 401", async () => {
    expect(await h.connect(cookieFor("ghost"))).toEqual({ status: 401 });
    h.db.addUser("D", 5); // token membawa versi 0
    expect(await h.connect(cookieFor("D"))).toEqual({ status: 401 });
  });
  it("cookie tanpa header Origin -> 403; Origin tidak terdaftar -> 403", async () => {
    expect(await h.connect({ cookie: "authjs.session-token=cookie-A" })).toEqual({ status: 403 });
    expect(await h.connect({ ...cookieFor("A"), origin: "http://evil.test" })).toEqual({ status: 403 });
  });
  it("bearer tanpa Origin diterima; bearer dengan Origin tak terdaftar ditolak 403", async () => {
    asConn(await h.connect(bearerFor("A")));
    expect(await h.connect({ ...bearerFor("A"), origin: "http://evil.test" })).toEqual({ status: 403 });
    asConn(await h.connect({ ...bearerFor("A"), origin: ORIGIN }));
  });
  it("cookie valid + Origin terdaftar diterima", async () => {
    asConn(await h.connect(cookieFor("A")));
  });
  it("error infrastruktur saat verifikasi -> 503, bukan 401", async () => {
    const broken = await setup({
      auth: () => ({
        verifyBearer: async () => {
          throw new Error("secret salah");
        },
      }),
    });
    expect(await broken.connect(bearerFor("A"))).toEqual({ status: 503 });
    await broken.stop();
  });
});

describe("batas koneksi per user (hanya socket OPEN)", () => {
  it("koneksi ke-6 dari user yang sama ditolak 429; user lain tidak terpengaruh", async () => {
    for (let i = 0; i < 5; i += 1) asConn(await h.connect(cookieFor("A")));
    expect(await h.connect(cookieFor("A"))).toEqual({ status: 429 });
    asConn(await h.connect(cookieFor("B")));
  });
  it("socket yang sudah tertutup tidak dihitung", async () => {
    const conns: Connected[] = [];
    for (let i = 0; i < 5; i += 1) conns.push(asConn(await h.connect(cookieFor("A"))));
    conns[0].ws.close();
    await waitFor(() => h.hub.openCount("A") === 4);
    asConn(await h.connect(cookieFor("A")));
  });
  it("socket yang gagal heartbeat di-terminate dan keluar dari hitungan", async () => {
    const hb = await setup({ maxConnPerUser: 1, pingMs: 40 });
    hb.db.addUser("A");
    asConn(await hb.connect(cookieFor("A"), { autoPong: false })); // klien yang tidak pernah membalas pong
    expect(await hb.connect(cookieFor("A"))).toEqual({ status: 429 });
    await waitFor(() => hb.hub.openCount("A") === 0, 1500);
    asConn(await hb.connect(cookieFor("A")));
    await hb.stop();
  });
});

describe("filter broadcast per device", () => {
  it("user A tidak menerima update device milik user B", async () => {
    const a = asConn(await h.connect(cookieFor("A")));
    const b = asConn(await h.connect(cookieFor("B")));
    h.hub.broadcast("bms:update", update("devB", 1));
    h.hub.broadcast("bms:update", update("devA", 2));
    await h.hub.flush();
    await waitFor(() => a.messages.length === 1 && b.messages.length === 1);
    await tick();
    expect(seqs(a.messages)).toEqual([2]);
    expect(seqs(b.messages)).toEqual([1]);
  });
  it("bentuk pesan tetap { event, payload, ts }", async () => {
    const a = asConn(await h.connect(cookieFor("A")));
    h.hub.broadcast("bms:update", update("devA", 1));
    await waitFor(() => a.messages.length === 1);
    const msg = JSON.parse(a.messages[0]) as Record<string, unknown>;
    expect(Object.keys(msg).sort()).toEqual(["event", "payload", "ts"]);
    expect(msg.event).toBe("bms:update");
  });
  it("kolaborator menerima; setelah dihapus (invalidateDevice) berhenti menerima", async () => {
    h.db.members.get("devA")!.add("C");
    const c = asConn(await h.connect(bearerFor("C")));
    h.hub.broadcast("bms:update", update("devA", 1));
    await waitFor(() => c.messages.length === 1);

    h.db.members.get("devA")!.delete("C");
    h.hub.invalidateDevice("devA");
    h.hub.broadcast("bms:update", update("devA", 2));
    await h.hub.flush();
    await tick();
    expect(seqs(c.messages)).toEqual([1]);
  });
  it("device tanpa anggota (belum diklaim) tidak dikirim ke siapa pun", async () => {
    const a = asConn(await h.connect(cookieFor("A")));
    h.hub.broadcast("bms:update", update("devOrphan", 1));
    await h.hub.flush();
    await tick();
    expect(a.messages).toEqual([]);
  });
  it("payload tanpa id device tidak dikirim ke siapa pun dan tidak melempar", async () => {
    const a = asConn(await h.connect(cookieFor("A")));
    expect(() => h.hub.broadcast("bms:update", { packs: [] })).not.toThrow();
    await h.hub.flush();
    await tick();
    expect(a.messages).toEqual([]);
  });
  it("indeks tidak query DB per pesan: banyak pesan = satu pemuatan", async () => {
    const a = asConn(await h.connect(cookieFor("A")));
    for (let i = 0; i < 20; i += 1) h.hub.broadcast("bms:update", update("devA", i));
    await waitFor(() => a.messages.length === 20);
    expect(h.db.memberLoads).toBe(1);
  });
});

describe("race cache keanggotaan", () => {
  it("kolaborator dihapus SAAT pemuatan cache berjalan: hasil lama dibuang, pesan tidak sampai ke dia", async () => {
    h.db.members.get("devA")!.add("C");
    const c = asConn(await h.connect(cookieFor("C")));

    let open!: () => void;
    h.db.gate = new Promise<void>((r) => (open = r));
    h.hub.broadcast("bms:update", update("devA", 1)); // memulai pemuatan; snapshot lama masih memuat C
    await waitFor(() => h.db.memberLoads === 1);

    // di tengah pemuatan: C dihapus dan cache diinvalidasi
    h.db.members.get("devA")!.delete("C");
    h.hub.invalidateDevice("devA");
    h.db.gate = null;
    open();

    h.hub.broadcast("bms:update", update("devA", 2));
    await h.hub.flush();
    await tick();
    expect(c.messages).toEqual([]); // baik pesan yang tertunda maupun yang berikutnya
    expect(h.db.memberLoads).toBe(2); // hasil lama tidak di-cache; dimuat ulang sekali
  });
  it("pemuatan bersamaan untuk device yang sama berbagi satu query", async () => {
    const a = asConn(await h.connect(cookieFor("A")));
    let open!: () => void;
    h.db.gate = new Promise<void>((r) => (open = r));
    h.hub.broadcast("bms:update", update("devA", 1));
    h.hub.broadcast("bms:update", update("devA", 2));
    h.hub.broadcast("bms:update", update("devA", 3));
    await tick();
    open();
    await waitFor(() => a.messages.length === 3);
    expect(h.db.memberLoads).toBe(1);
  });
});

describe("urutan dan isolasi broadcast", () => {
  it("urutan pesan per device terjaga saat cache miss dengan pemuatan lambat", async () => {
    const a = asConn(await h.connect(cookieFor("A")));
    let open!: () => void;
    h.db.gate = new Promise<void>((r) => (open = r));
    for (let i = 1; i <= 5; i += 1) h.hub.broadcast("bms:update", update("devA", i));
    await tick();
    open();
    await waitFor(() => a.messages.length === 5);
    expect(seqs(a.messages)).toEqual([1, 2, 3, 4, 5]);
  });
  it("broadcast sinkron dan tidak melempar saat query keanggotaan gagal; pesan berikutnya tetap jalan", async () => {
    const a = asConn(await h.connect(cookieFor("A")));
    h.db.failLoads = true;
    const t0 = Date.now();
    expect(() => h.hub.broadcast("bms:update", update("devA", 1))).not.toThrow();
    expect(Date.now() - t0).toBeLessThan(20);
    await h.hub.flush();
    expect(a.messages).toEqual([]);

    h.db.failLoads = false;
    h.hub.broadcast("bms:update", update("devA", 2));
    await waitFor(() => a.messages.length === 1);
    expect(seqs(a.messages)).toEqual([2]);
  });
  it("socket yang mati tidak menghentikan pengiriman ke koneksi lain", async () => {
    const first = asConn(await h.connect(cookieFor("A")));
    const second = asConn(await h.connect(cookieFor("A")));
    first.ws.terminate();
    h.hub.broadcast("bms:update", update("devA", 1));
    await waitFor(() => second.messages.length === 1);
  });
});

describe("masa hidup koneksi", () => {
  it("tokenVersion berubah -> revalidateUser menutup koneksi dengan 4401", async () => {
    const c = asConn(await h.connect(cookieFor("A")));
    const closed = closeCode(c);
    h.db.addUser("A", 1);
    await h.hub.revalidateUser("A");
    expect(await closed).toBe(WS_CLOSE_UNAUTHENTICATED);
  });
  it("user dihapus -> koneksi ditutup 4401; user lain tetap tersambung", async () => {
    const a = asConn(await h.connect(cookieFor("A")));
    const b = asConn(await h.connect(cookieFor("B")));
    const closed = closeCode(a);
    h.db.users.delete("A");
    await h.hub.revalidateAll();
    expect(await closed).toBe(4401);
    expect(b.ws.readyState).toBe(WebSocket.OPEN);
  });
  it("exp kredensial lewat -> ditutup 4401 (cookie maupun bearer)", async () => {
    const soon = Math.floor(Date.now() / 1000) + 1;
    const short = await setup({
      auth: () => ({
        verifyBearer: async () => ({ userId: "A", tokenVersion: 0, expSec: soon }),
        verifyCookie: async () => ({ userId: "A", tokenVersion: 0, expSec: soon, idleDeadlineSec: soon + 3600, sessionId: "s" }),
      }),
    });
    short.db.addUser("A");
    const viaCookie = asConn(await short.connect(cookieFor("A")));
    const viaBearer = asConn(await short.connect(bearerFor("A")));
    expect(await Promise.all([closeCode(viaCookie), closeCode(viaBearer)])).toEqual([4401, 4401]);
    await short.stop();
  });
  it("exp yang sudah lewat saat handshake -> 401", async () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const old = await setup({ auth: () => ({ verifyCookie: async () => ({ userId: "A", tokenVersion: 0, expSec: past, idleDeadlineSec: past + 7200, sessionId: "s" }) }) });
    old.db.addUser("A");
    expect(await old.connect(cookieFor("A"))).toEqual({ status: 401 });
    await old.stop();
  });
  it("kegagalan DB saat revalidasi tidak memutus koneksi", async () => {
    const hub = new WsHub(
      { maxConnPerUser: 5, membershipTtlMs: 1000, pingMs: 60_000, revalidateMs: 60_000 },
      {
        loadMembers: async () => new Set(),
        loadUsers: async () => {
          throw new Error("db down");
        },
      },
    );
    await expect(hub.revalidateAll()).resolves.toBeUndefined();
  });
});

describe("batas idle sesi web", () => {
  const nowSec = () => Math.floor(Date.now() / 1000);
  const withCookie = (claims: { idleDeadlineSec?: number | null; sessionId?: string | null }) =>
    setup({ auth: () => ({ verifyCookie: async () => ({ userId: "A", tokenVersion: 0, expSec: null, sessionId: "s1", ...claims }) }) });

  it("cookie idle (deadline lewat) ditolak 401 saat handshake", async () => {
    const x = await withCookie({ idleDeadlineSec: nowSec() - 1 });
    x.db.addUser("A");
    expect(await x.connect(cookieFor("A"))).toEqual({ status: 401 });
    await x.stop();
  });
  it("cookie tanpa klaim idle (sesi lama) ditolak 401; bearer tidak terpengaruh", async () => {
    const x = await withCookie({ idleDeadlineSec: null });
    x.db.addUser("A");
    expect(await x.connect(cookieFor("A"))).toEqual({ status: 401 });
    asConn(await x.connect(bearerFor("A")));
    await x.stop();
  });
  it("koneksi cookie ditutup 4401 tepat di batas idle", async () => {
    const x = await withCookie({ idleDeadlineSec: nowSec() + 1 });
    x.db.addUser("A");
    const c = asConn(await x.connect(cookieFor("A")));
    expect(await closeCode(c)).toBe(4401);
    await x.stop();
  });
  it("extendSessionIdle memperpanjang SESI yang sama saja; sesi/perangkat lain tetap ditutup", async () => {
    const x = await setup({
      auth: () => ({
        verifyCookie: async (v) => ({
          userId: "A",
          tokenVersion: 0,
          expSec: null,
          idleDeadlineSec: nowSec() + 1,
          sessionId: v.slice(7), // cookie-<sid>
        }),
      }),
    });
    x.db.addUser("A");
    const active = asConn(await x.connect(cookieFor("S1")));
    const other = asConn(await x.connect(cookieFor("S2")));
    expect(x.hub.extendSessionIdle("A", "S1", Date.now() + 60_000)).toBe(1);
    expect(await closeCode(other)).toBe(4401);
    expect(active.ws.readyState).toBe(WebSocket.OPEN);
    // tidak memundurkan dan tidak menyentuh sesi yang tidak dikenal
    expect(x.hub.extendSessionIdle("A", "S1", Date.now() + 1000)).toBe(0);
    expect(x.hub.extendSessionIdle("A", "NOPE", Date.now() + 60_000)).toBe(0);
    await x.stop();
  });
});
