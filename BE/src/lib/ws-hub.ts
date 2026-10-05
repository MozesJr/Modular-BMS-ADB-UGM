import type { WebSocket } from "ws";
import { checkSessionAgainstUser, type DbUserForSession } from "@/lib/session-check";
import { log } from "@/lib/logger";

// Hub koneksi /ws: indeks koneksi per user + indeks keanggotaan per device (cache di memori), supaya
// "bms:update" hanya sampai ke user yang berhak (owner/collaborator) TANPA query DB per pesan per koneksi.
// Modul ini sengaja murni (tanpa Prisma/Next): dependensi DB disuntikkan lewat WsHubDeps, jadi mudah dites.
// State hub disimpan di globalThis (lihat getHub) karena route handler Next dan custom server punya salinan modul sendiri.

export const WS_CLOSE_UNAUTHENTICATED = 4401;

const MAX_PENDING_PER_DEVICE = 100; // batas antrean pengiriman per device (jaga memori bila DB macet)
const MAX_BUFFERED_BYTES = 1024 * 1024; // klien lambat dengan buffer > 1 MiB diputus
const MEMBERSHIP_LOAD_ATTEMPTS = 3;
const MAX_TIMER_MS = 2 ** 31 - 1;

export interface WsHubConfig {
  maxConnPerUser: number;
  membershipTtlMs: number;
  pingMs: number;
  revalidateMs: number;
  now?: () => number;
}

export interface WsHubDeps {
  // Himpunan userId yang boleh melihat device (owner + collaborator). Set kosong bila device tidak ada.
  loadMembers(deviceId: string): Promise<ReadonlySet<string>>;
  loadUsers(userIds: string[]): Promise<DbUserForSession[]>;
}

export interface WsConnIdentity {
  userId: string;
  tokenVersion: number;
  // Batas hidup koneksi (exp JWT dan/atau expiresAt akun); null = tanpa batas dari kredensial.
  expiresAtMs: number | null;
  // Hanya koneksi cookie web: batas idle sesi (epoch ms) dan id sesi (klaim `sid`). Koneksi ditutup di
  // min(expiresAtMs, idleDeadlineMs); extendSessionIdle() memajukan idleDeadlineMs bila user beraktivitas.
  idleDeadlineMs?: number | null;
  sessionId?: string | null;
}

interface Conn extends WsConnIdentity {
  ws: WebSocket;
  alive: boolean;
  expiryTimer: ReturnType<typeof setTimeout> | null;
}

interface DeliveryChain {
  tail: Promise<void>;
  pending: number;
}

const OPEN = 1; // WebSocket.OPEN

function deviceIdOf(payload: unknown): string | null {
  if (typeof payload === "object" && payload !== null && "id" in payload && typeof payload.id === "string" && payload.id) {
    return payload.id;
  }
  return null;
}

export class WsHub {
  private readonly now: () => number;
  private readonly connsByUser = new Map<string, Set<Conn>>();
  private readonly reserved = new Map<string, number>();

  // Cache keanggotaan + penanda generasi. generation naik pada setiap invalidasi; hasil load yang dimulai pada
  // generasi lama tidak pernah disimpan maupun dipakai.
  private readonly cache = new Map<string, { users: ReadonlySet<string>; loadedAt: number }>();
  private readonly generations = new Map<string, number>();
  private readonly inflight = new Map<string, { generation: number; promise: Promise<ReadonlySet<string>> }>();
  private generationCounter = 0;

  // Antrean pengiriman per device: menjamin urutan sama dengan urutan broadcast() dipanggil (urutan ingest),
  // juga saat cache miss (pesan berikutnya menunggu pemuatan pesan sebelumnya).
  private readonly chains = new Map<string, DeliveryChain>();

  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private revalidateTimer: ReturnType<typeof setInterval> | null = null;
  private revalidating = false;

  constructor(
    private readonly config: WsHubConfig,
    private readonly deps: WsHubDeps,
  ) {
    this.now = config.now ?? Date.now;
  }

  // ---- Siklus hidup ----------------------------------------------------------------------

  start() {
    if (this.pingTimer) return;
    this.pingTimer = setInterval(() => this.heartbeat(), this.config.pingMs);
    this.revalidateTimer = setInterval(() => void this.revalidateAll(), this.config.revalidateMs);
    this.pingTimer.unref();
    this.revalidateTimer.unref();
  }

  stop() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.revalidateTimer) clearInterval(this.revalidateTimer);
    this.pingTimer = null;
    this.revalidateTimer = null;
  }

  closeAll(code: number, reason: string) {
    this.stop();
    for (const conn of this.allConns()) this.closeConn(conn, code, reason);
  }

  // ---- Koneksi ---------------------------------------------------------------------------

  // Hanya socket OPEN yang dihitung. Dipanggil SEBELUM handleUpgrade; reservasi menutup celah balapan antara
  // pengecekan batas dan attach(). Panggil release() bila handshake gagal.
  reserve(userId: string): boolean {
    if (this.openCount(userId) + (this.reserved.get(userId) ?? 0) >= this.config.maxConnPerUser) return false;
    this.reserved.set(userId, (this.reserved.get(userId) ?? 0) + 1);
    return true;
  }

  release(userId: string) {
    const left = (this.reserved.get(userId) ?? 0) - 1;
    if (left > 0) this.reserved.set(userId, left);
    else this.reserved.delete(userId);
  }

  openCount(userId: string): number {
    let n = 0;
    for (const c of this.connsByUser.get(userId) ?? []) if (c.ws.readyState === OPEN) n += 1;
    return n;
  }

  // Mengonsumsi satu reservasi.
  attach(ws: WebSocket, identity: WsConnIdentity) {
    this.release(identity.userId);
    const conn: Conn = { ...identity, ws, alive: true, expiryTimer: null };
    let set = this.connsByUser.get(identity.userId);
    if (!set) this.connsByUser.set(identity.userId, (set = new Set()));
    set.add(conn);

    ws.on("pong", () => {
      conn.alive = true;
    });
    ws.on("message", () => {
      // Server -> klien saja. Pesan masuk diabaikan (maxPayload kecil di WebSocketServer).
    });
    ws.on("error", (err) => log.warn("ws.connection_error", { userId: conn.userId, err }));
    ws.on("close", () => this.remove(conn));
    this.scheduleExpiry(conn);
  }

  // Memajukan batas idle koneksi cookie milik SESI tertentu (user + sid). Tidak menyentuh koneksi sesi/perangkat lain
  // dan tidak pernah menghidupkan koneksi yang sudah ditutup. Mengembalikan jumlah koneksi yang diperpanjang.
  extendSessionIdle(userId: string, sessionId: string, idleDeadlineMs: number): number {
    let n = 0;
    for (const conn of this.connsByUser.get(userId) ?? []) {
      if (conn.sessionId !== sessionId || conn.idleDeadlineMs == null || idleDeadlineMs <= conn.idleDeadlineMs) continue;
      conn.idleDeadlineMs = idleDeadlineMs;
      this.scheduleExpiry(conn);
      n += 1;
    }
    return n;
  }

  private allConns(): Conn[] {
    return [...this.connsByUser.values()].flatMap((s) => [...s]);
  }

  private remove(conn: Conn) {
    if (conn.expiryTimer) clearTimeout(conn.expiryTimer);
    conn.expiryTimer = null;
    const set = this.connsByUser.get(conn.userId);
    if (!set) return;
    set.delete(conn);
    if (set.size === 0) this.connsByUser.delete(conn.userId);
  }

  private closeConn(conn: Conn, code: number, reason: string) {
    this.remove(conn);
    try {
      conn.ws.close(code, reason);
    } catch (err) {
      log.warn("ws.close_failed", { userId: conn.userId, err });
      conn.ws.terminate();
    }
  }

  private scheduleExpiry(conn: Conn) {
    if (conn.expiryTimer) clearTimeout(conn.expiryTimer);
    conn.expiryTimer = null;
    const limits = [conn.expiresAtMs, conn.idleDeadlineMs ?? null].filter((v): v is number => v !== null);
    if (limits.length === 0) return;
    const wait = Math.min(...limits) - this.now();
    if (wait <= 0) {
      this.closeConn(conn, WS_CLOSE_UNAUTHENTICATED, "session expired");
      return;
    }
    conn.expiryTimer = setTimeout(() => this.scheduleExpiry(conn), Math.min(wait, MAX_TIMER_MS));
    conn.expiryTimer.unref();
  }

  // Ping tiap siklus; yang tidak membalas pong sejak siklus lalu di-terminate DAN langsung dikeluarkan dari indeks
  // (supaya tidak ikut terhitung dalam batas koneksi per user).
  private heartbeat() {
    this.sweepCache();
    for (const conn of this.allConns()) {
      if (!conn.alive) {
        this.remove(conn);
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      try {
        conn.ws.ping();
      } catch (err) {
        log.warn("ws.ping_failed", { userId: conn.userId, err });
        this.remove(conn);
        conn.ws.terminate();
      }
    }
  }

  // ---- Validasi ulang sesi ---------------------------------------------------------------

  async revalidateAll(): Promise<void> {
    if (this.revalidating) return;
    this.revalidating = true;
    try {
      await this.revalidateUsers([...this.connsByUser.keys()]);
    } finally {
      this.revalidating = false;
    }
  }

  // Dipanggil saat user diubah/dihapus/password direset/logout-all: cek ulang ke DB sekarang juga.
  async revalidateUser(userId: string): Promise<void> {
    await this.revalidateUsers([userId]);
  }

  private async revalidateUsers(userIds: string[]) {
    if (userIds.length === 0) return;
    let users: DbUserForSession[];
    try {
      users = await this.deps.loadUsers(userIds);
    } catch (err) {
      // Kegagalan DB sesaat tidak boleh memutus semua koneksi; batas exp tetap ditegakkan oleh timer.
      log.error("ws.revalidate_failed", { err });
      return;
    }
    const byId = new Map(users.map((u) => [u.id, u]));
    const now = this.now();
    for (const userId of userIds) {
      const user = byId.get(userId) ?? null;
      for (const conn of [...(this.connsByUser.get(userId) ?? [])]) {
        const check = checkSessionAgainstUser({ id: userId, tokenVersion: conn.tokenVersion }, user, now);
        if (!check.ok) {
          log.info("ws.session_invalid", { userId, reason: check.reason });
          this.closeConn(conn, WS_CLOSE_UNAUTHENTICATED, "session invalid");
        }
      }
    }
  }

  // ---- Keanggotaan device ----------------------------------------------------------------

  // Panggil SETELAH mutasi DB yang mengubah siapa yang boleh melihat device (klaim, unclaim, hapus device,
  // tambah/cabut collaborator). Aman terhadap pemuatan yang sedang berjalan (lihat generations).
  invalidateDevice(deviceId: string) {
    this.generations.set(deviceId, ++this.generationCounter);
    this.cache.delete(deviceId);
    this.inflight.delete(deviceId);
  }

  private generationOf(deviceId: string): number {
    return this.generations.get(deviceId) ?? 0;
  }

  private sweepCache() {
    const now = this.now();
    for (const [id, entry] of this.cache) {
      if (now - entry.loadedAt >= this.config.membershipTtlMs) this.cache.delete(id);
    }
  }

  private async membersOf(deviceId: string): Promise<ReadonlySet<string>> {
    for (let attempt = 0; attempt < MEMBERSHIP_LOAD_ATTEMPTS; attempt += 1) {
      const hit = this.cache.get(deviceId);
      if (hit && this.now() - hit.loadedAt < this.config.membershipTtlMs) return hit.users;

      let entry = this.inflight.get(deviceId);
      if (!entry || entry.generation !== this.generationOf(deviceId)) {
        const generation = this.generationOf(deviceId);
        const started: { generation: number; promise: Promise<ReadonlySet<string>> } = {
          generation,
          promise: this.deps.loadMembers(deviceId).then((users) => {
            // Hasil dari generasi lama dibuang: tidak disimpan ke cache.
            if (this.generationOf(deviceId) === generation) {
              this.cache.set(deviceId, { users, loadedAt: this.now() });
            }
            return users;
          }),
        };
        const clear = () => {
          if (this.inflight.get(deviceId) === started) this.inflight.delete(deviceId);
        };
        started.promise.then(clear, clear);
        this.inflight.set(deviceId, started);
        entry = started;
      }

      const users = await entry.promise;
      // Dipakai hanya bila tidak ada invalidasi selama pemuatan; kalau ada, ulang dengan data baru.
      if (this.generationOf(deviceId) === entry.generation) return users;
    }
    throw new Error("membership_unstable");
  }

  // ---- Broadcast -------------------------------------------------------------------------

  // Sinkron dan TIDAK PERNAH melempar/menunggu: pemanggil (ingest) tidak boleh terhambat atau gagal karena WS.
  // Pengiriman berjalan di antrean per device.
  broadcast(event: string, payload: unknown): void {
    try {
      const deviceId = deviceIdOf(payload);
      if (!deviceId) {
        log.warn("ws.broadcast_without_device_id", { name: event });
        return;
      }
      if (this.connsByUser.size === 0) return; // tidak ada pendengar: lewati (tanpa query DB)

      const message = JSON.stringify({ event, payload, ts: this.now() });
      let chain = this.chains.get(deviceId);
      if (!chain) this.chains.set(deviceId, (chain = { tail: Promise.resolve(), pending: 0 }));
      if (chain.pending >= MAX_PENDING_PER_DEVICE) {
        log.warn("ws.delivery_backlog_dropped", { deviceId });
        return;
      }
      chain.pending += 1;
      const current = chain;
      current.tail = current.tail
        .then(() => this.deliver(deviceId, message))
        .catch((err) => log.error("ws.deliver_failed", { deviceId, err }))
        .then(() => {
          current.pending -= 1;
          if (current.pending === 0 && this.chains.get(deviceId) === current) this.chains.delete(deviceId);
        });
    } catch (err) {
      log.error("ws.broadcast_failed", { name: event, err });
    }
  }

  // Menunggu semua pengiriman yang sedang antre (untuk shutdown dan tes).
  async flush(): Promise<void> {
    await Promise.all([...this.chains.values()].map((c) => c.tail));
  }

  private async deliver(deviceId: string, message: string) {
    const members = await this.membersOf(deviceId);
    for (const userId of members) {
      const conns = this.connsByUser.get(userId);
      if (!conns) continue;
      for (const conn of [...conns]) {
        const ws = conn.ws;
        if (ws.readyState !== OPEN) continue;
        if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
          log.warn("ws.slow_consumer_terminated", { userId });
          this.remove(conn);
          ws.terminate();
          continue;
        }
        try {
          ws.send(message, (err) => {
            if (err) log.warn("ws.send_failed", { userId, err });
          });
        } catch (err) {
          log.warn("ws.send_failed", { userId, err });
        }
      }
    }
  }
}

// ---- Singleton lintas "dunia" modul (custom server vs. route handler Next) ---------------

const KEY = Symbol.for("bms.wsHub");
type GlobalWithHub = typeof globalThis & { [KEY]?: WsHub };

export function setHub(hub: WsHub | null) {
  const g = globalThis as GlobalWithHub;
  if (hub) g[KEY] = hub;
  else delete g[KEY];
}

export function getHub(): WsHub | null {
  return (globalThis as GlobalWithHub)[KEY] ?? null;
}

// Helper untuk route handler. No-op bila hub belum ada (mis. tes unit) — tidak pernah melempar.
export function invalidateDevice(deviceId: string): void {
  getHub()?.invalidateDevice(deviceId);
}

// Dipanggil callback jwt Auth.js saat user beraktivitas (update eksplisit). No-op tanpa hub; tidak pernah melempar.
export function extendSessionIdle(userId: string, sessionId: string, idleDeadlineMs: number): void {
  getHub()?.extendSessionIdle(userId, sessionId, idleDeadlineMs);
}

export function revalidateUser(userId: string): void {
  void getHub()
    ?.revalidateUser(userId)
    .catch((err) => log.error("ws.revalidate_failed", { userId, err }));
}
