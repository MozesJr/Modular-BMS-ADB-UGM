// SATU fungsi yang memutuskan "sudah login" untuk proxy.ts. Murni (tanpa Next/next-auth) supaya dapat dites.
// Deadline idle dihitung SERVER dan ditulis ke klaim JWT `ida` (epoch detik); FE tidak punya konfigurasi idle sendiri.
// Sesi idle diperlakukan sebagai BELUM login di semua cabang (termasuk halaman auth), supaya /signin tidak memantul ke "/"
// selama cookie idle masih tersimpan di browser.
export type SessionState =
  | { status: "authenticated" }
  | { status: "anonymous" }
  | { status: "expired" } // akun melewati expiresAt
  | { status: "idle"; legacy: boolean }; // legacy = JWT lama tanpa klaim `ida` (ditolak, login ulang sekali)

export interface SessionTokenLike {
  ida?: unknown;
  expiresAt?: unknown;
}

export function evaluateSession(token: SessionTokenLike | null | undefined, nowMs: number): SessionState {
  if (!token) return { status: "anonymous" };
  if (typeof token.expiresAt === "string" && new Date(token.expiresAt).getTime() < nowMs) return { status: "expired" };
  const ida = token.ida;
  if (typeof ida !== "number" || !Number.isFinite(ida)) return { status: "idle", legacy: true };
  if (nowMs >= ida * 1000) return { status: "idle", legacy: false };
  return { status: "authenticated" };
}

export const isLoggedIn = (state: SessionState): boolean => state.status === "authenticated";
