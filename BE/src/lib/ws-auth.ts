import type { IncomingHttpHeaders } from "node:http";
import { checkSessionAgainstUser, type DbUserForSession } from "@/lib/session-check";
import { log } from "@/lib/logger";
import { isIdleExpired } from "@/lib/session-idle";
import type { WsConnIdentity } from "@/lib/ws-hub";

// Autentikasi handshake /ws dari header mentah (IncomingMessage). Murni: verifikasi kredensial dan akses DB
// disuntikkan lewat WsAuthDeps. Aturan "sesi valid" memakai checkSessionAgainstUser yang sama dengan REST
// (user ada, belum expired, tokenVersion sama). JANGAN pernah mencatat nilai cookie/token di log.

export const SESSION_COOKIE_NAMES = ["__Secure-authjs.session-token", "authjs.session-token"] as const;

export interface VerifiedClaims {
  userId: string;
  tokenVersion: number;
  expSec: number | null;
  // Cookie web: idle deadline (epoch detik) dari klaim `ida`; null = klaim hilang (sesi lama). Bearer: undefined.
  idleDeadlineSec?: number | null;
  sessionId?: string | null;
}

export interface WsAuthDeps {
  allowedOrigins: ReadonlySet<string>;
  verifyBearer(token: string): Promise<VerifiedClaims | null>;
  // `salt` = nama cookie (Auth.js memakainya sebagai salt dekripsi JWT).
  verifyCookie(value: string, salt: string): Promise<VerifiedClaims | null>;
  loadUser(userId: string): Promise<DbUserForSession | null>;
  now?: () => number;
}

export type UpgradeResult =
  | { ok: true; kind: "cookie" | "bearer"; identity: WsConnIdentity }
  | { ok: false; status: 401 | 403 | 503; reason: string };

// Mengembalikan nama + nilai cookie sesi Auth.js (mendukung cookie yang dipecah .0/.1/...).
export function extractSessionCookie(cookieHeader: string | undefined): { name: string; value: string } | null {
  if (!cookieHeader) return null;
  const jar = new Map<string, string>();
  for (const part of cookieHeader.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    jar.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  for (const name of SESSION_COOKIE_NAMES) {
    const whole = jar.get(name);
    if (whole) return { name, value: whole };
    const chunks: string[] = [];
    for (let n = 0; jar.has(`${name}.${n}`); n += 1) chunks.push(jar.get(`${name}.${n}`)!);
    if (chunks.length > 0) return { name, value: chunks.join("") };
  }
  return null;
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const v = headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function originAllowed(origin: string | undefined, allowed: ReadonlySet<string>): boolean {
  return origin !== undefined && allowed.has(origin.trim().toLowerCase());
}

export async function authenticateUpgrade(headers: IncomingHttpHeaders, deps: WsAuthDeps): Promise<UpgradeResult> {
  const now = (deps.now ?? Date.now)();
  const origin = headerValue(headers, "origin");
  const authorization = headerValue(headers, "authorization");

  // 1) Jenis kredensial. Authorization ada tapi tidak valid -> gagal tegas, tidak jatuh ke cookie (sama seperti REST).
  let kind: "bearer" | "cookie";
  let bearerToken = "";
  let cookie: { name: string; value: string } | null = null;
  if (authorization !== undefined) {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
    if (!match) return { ok: false, status: 401, reason: "invalid_authorization" };
    kind = "bearer";
    bearerToken = match[1];
  } else {
    cookie = extractSessionCookie(headerValue(headers, "cookie"));
    if (!cookie) return { ok: false, status: 401, reason: "no_credentials" };
    kind = "cookie";
  }

  // 2) Origin (murah, sebelum menyentuh DB). Cookie: WAJIB ada dan terdaftar (anti cross-site WebSocket hijacking).
  //    Bearer: boleh tidak ada (klien native), tetapi bila ada harus terdaftar.
  if (kind === "cookie") {
    if (!originAllowed(origin, deps.allowedOrigins)) {
      return { ok: false, status: 403, reason: origin === undefined ? "origin_missing" : "origin_not_allowed" };
    }
  } else if (origin !== undefined && !originAllowed(origin, deps.allowedOrigins)) {
    return { ok: false, status: 403, reason: "origin_not_allowed" };
  }

  // 3) Verifikasi kredensial + cek DB. Error infrastruktur (DB mati, secret salah) = 503, BUKAN 401: klien tidak
  //    boleh mengira dirinya logout.
  try {
    const claims = kind === "bearer" ? await deps.verifyBearer(bearerToken) : await deps.verifyCookie(cookie!.value, cookie!.name);
    if (!claims) return { ok: false, status: 401, reason: "invalid_credentials" };
    if (claims.expSec !== null && claims.expSec * 1000 <= now) return { ok: false, status: 401, reason: "credentials_expired" };

    // Cookie web: batas idle (klaim hilang = sesi lama = ditolak, sama seperti di callback jwt Auth.js).
    if (kind === "cookie" && isIdleExpired(claims.idleDeadlineSec, Math.floor(now / 1000))) {
      return { ok: false, status: 401, reason: "session_idle" };
    }

    const user = await deps.loadUser(claims.userId);
    const check = checkSessionAgainstUser({ id: claims.userId, tokenVersion: claims.tokenVersion }, user, now);
    if (!check.ok || !user) return { ok: false, status: 401, reason: check.ok ? "user_missing" : check.reason };

    const limits = [claims.expSec !== null ? claims.expSec * 1000 : null, user.expiresAt ? user.expiresAt.getTime() : null].filter(
      (v): v is number => v !== null,
    );
    return {
      ok: true,
      kind,
      identity: {
        userId: user.id,
        tokenVersion: claims.tokenVersion,
        expiresAtMs: limits.length > 0 ? Math.min(...limits) : null,
        // Cookie web: koneksi ditutup (4401) tepat di batas idle; diperpanjang hub bila user aktif (extendSessionIdle).
        idleDeadlineMs: kind === "cookie" && typeof claims.idleDeadlineSec === "number" ? claims.idleDeadlineSec * 1000 : null,
        sessionId: kind === "cookie" ? (claims.sessionId ?? null) : null,
      },
    };
  } catch (err) {
    log.error("ws.auth_unavailable", { err });
    return { ok: false, status: 503, reason: "auth_unavailable" };
  }
}
