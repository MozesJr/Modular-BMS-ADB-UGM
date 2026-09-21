import { err } from "@/lib/http";

// Rate limiter in-memory (sliding-window counter). Cocok untuk SATU instance BE (keputusan Q7);
// bila BE di-scale >1 instance, ganti store dengan Redis/Postgres. State di globalThis supaya
// tahan hot-reload dan konsisten di proses yang sama.

export interface RateLimitPolicy {
  name: string;
  limit: number;
  windowMs: number;
}

// Kebijakan per endpoint (IP dan akun dihitung terpisah).
export const POLICIES = {
  loginIp: { name: "login:ip", limit: 30, windowMs: 15 * 60_000 },
  loginAccount: { name: "login:acct", limit: 10, windowMs: 15 * 60_000 },
  registerIp: { name: "register:ip", limit: 10, windowMs: 60 * 60_000 },
  forgotIp: { name: "forgot:ip", limit: 5, windowMs: 15 * 60_000 },
  forgotEmail: { name: "forgot:email", limit: 3, windowMs: 60 * 60_000 },
  resetIp: { name: "reset:ip", limit: 10, windowMs: 15 * 60_000 },
  // Klaim/registrasi device dan undangan collaborator (per user): mencegah spam device dan enumerasi email
  claimUser: { name: "claim:user", limit: 20, windowMs: 60 * 60_000 },
  collabAddUser: { name: "collab-add:user", limit: 30, windowMs: 60 * 60_000 },
  // Dipakai endpoint token mobile (fase B2)
  refreshIp: { name: "refresh:ip", limit: 60, windowMs: 15 * 60_000 },
} as const satisfies Record<string, RateLimitPolicy>;

interface Entry {
  windowStart: number;
  current: number;
  previous: number;
}

export interface HitResult {
  allowed: boolean;
  retryAfterSec: number;
}

const MAX_ENTRIES = 100_000;

export class SlidingWindowLimiter {
  private entries = new Map<string, Entry>();

  hit(key: string, limit: number, windowMs: number, now: number = Date.now()): HitResult {
    let e = this.entries.get(key);
    if (!e) {
      if (this.entries.size >= MAX_ENTRIES) this.sweep(now, true);
      e = { windowStart: Math.floor(now / windowMs) * windowMs, current: 0, previous: 0 };
      this.entries.set(key, e);
    }

    const elapsed = Math.floor((now - e.windowStart) / windowMs);
    if (elapsed >= 2) {
      e.previous = 0;
      e.current = 0;
      e.windowStart = Math.floor(now / windowMs) * windowMs;
    } else if (elapsed === 1) {
      e.previous = e.current;
      e.current = 0;
      e.windowStart += windowMs;
    }

    const weight = 1 - (now - e.windowStart) / windowMs;
    const estimated = e.previous * weight + e.current;

    if (estimated >= limit) {
      // Percobaan yang ditolak tidak menambah hitungan (tidak memperpanjang blokir).
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((e.windowStart + windowMs - now) / 1000)) };
    }
    e.current += 1;
    return { allowed: true, retryAfterSec: 0 };
  }

  // Buang entri yang sudah tidak relevan (dua jendela lewat). `force`: bila masih penuh, buang yang tertua.
  sweep(now: number = Date.now(), force = false, maxWindowMs = 60 * 60_000) {
    for (const [k, e] of this.entries) {
      if (now - e.windowStart > 2 * maxWindowMs) this.entries.delete(k);
    }
    if (force && this.entries.size >= MAX_ENTRIES) {
      const drop = Math.ceil(MAX_ENTRIES * 0.1);
      let i = 0;
      for (const k of this.entries.keys()) {
        this.entries.delete(k);
        if (++i >= drop) break;
      }
    }
  }

  get size() {
    return this.entries.size;
  }
}

const KEY = Symbol.for("bms.rateLimiter");
type G = typeof globalThis & { [KEY]?: SlidingWindowLimiter };

function limiter(): SlidingWindowLimiter {
  const g = globalThis as G;
  if (!g[KEY]) {
    g[KEY] = new SlidingWindowLimiter();
    setInterval(() => g[KEY]?.sweep(), 5 * 60_000).unref?.();
  }
  return g[KEY]!;
}

// Cek beberapa kunci sekaligus; bila salah satu melebihi batas -> 429 dengan Retry-After terbesar.
export function enforceRateLimit(checks: Array<{ policy: RateLimitPolicy; id: string }>) {
  let denied: HitResult | null = null;
  for (const { policy, id } of checks) {
    const r = limiter().hit(`${policy.name}:${id}`, policy.limit, policy.windowMs);
    if (!r.allowed && (!denied || r.retryAfterSec > denied.retryAfterSec)) denied = r;
  }
  if (denied) throw err.tooMany(denied.retryAfterSec);
}
