// Batas idle sesi WEB (cookie Auth.js). Fungsi murni: tanpa Next, tanpa Prisma, tanpa jam global (now selalu disuntikkan),
// supaya dapat dites tanpa browser dan boleh dipakai custom server (/ws). JANGAN impor next/* di sini.
//
// Model: JWE sesi membawa klaim `ida` (idle deadline, epoch DETIK) yang dihitung SERVER = waktu aktivitas + batas idle.
//  - diset saat login, dan HANYA dimajukan oleh panggilan eksplisit FE (trigger "update") akibat interaksi user;
//  - pembacaan biasa (REST, polling, GET /api/auth/session, WS) tidak pernah mengubahnya;
//  - klaim hilang (JWT lama sebelum fitur ini) = sesi idle (login ulang satu kali, tanpa masa transisi);
//  - sesi yang sudah idle tidak bisa dihidupkan lagi oleh "update".

export const DEFAULT_IDLE_MINUTES = 30;
export const DEFAULT_IDLE_WARNING_SECONDS = 60;

type Env = Record<string, string | undefined>;

export interface IdleConfig {
  timeoutSec: number;
  warningSec: number;
}

function positiveInt(raw: string | undefined): number | null {
  return raw !== undefined && /^[1-9]\d*$/.test(raw) ? Number.parseInt(raw, 10) : null;
}

// Nilai tidak valid jatuh ke default (env-check menolaknya saat startup). Peringatan selalu lebih pendek dari batas idle.
export function idleConfig(env: Env = process.env): IdleConfig {
  const timeoutSec = (positiveInt(env.SESSION_IDLE_MINUTES) ?? DEFAULT_IDLE_MINUTES) * 60;
  const warning = positiveInt(env.SESSION_IDLE_WARNING_SECONDS) ?? DEFAULT_IDLE_WARNING_SECONDS;
  return { timeoutSec, warningSec: Math.min(warning, Math.max(1, timeoutSec - 1)) };
}

export function idleDeadlineSec(nowSec: number, timeoutSec: number): number {
  return nowSec + timeoutSec;
}

// Klaim hilang / bukan angka dianggap sudah idle.
export function isIdleExpired(deadlineSec: unknown, nowSec: number): boolean {
  return typeof deadlineSec !== "number" || !Number.isFinite(deadlineSec) || nowSec >= deadlineSec;
}

export function remainingIdleSec(deadlineSec: unknown, nowSec: number): number {
  return typeof deadlineSec === "number" && Number.isFinite(deadlineSec) ? Math.max(0, Math.ceil(deadlineSec - nowSec)) : 0;
}

export type JwtIdleDecision =
  | { kind: "expired" }
  | { kind: "ok"; deadlineSec: number; extended: boolean };

// Keputusan callback jwt untuk token yang SUDAH ada (bukan login). `explicitTouch` = true hanya untuk trigger "update".
export function evaluateJwtIdle(input: {
  deadlineSec: unknown;
  nowSec: number;
  timeoutSec: number;
  explicitTouch: boolean;
}): JwtIdleDecision {
  if (isIdleExpired(input.deadlineSec, input.nowSec)) return { kind: "expired" };
  if (input.explicitTouch) return { kind: "ok", deadlineSec: idleDeadlineSec(input.nowSec, input.timeoutSec), extended: true };
  return { kind: "ok", deadlineSec: input.deadlineSec as number, extended: false };
}
