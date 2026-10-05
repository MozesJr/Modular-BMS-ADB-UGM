import { signOut } from "next-auth/react";
import { buildSignInUrl, type SignInReason } from "@/lib/callbackUrl";

// SATU jalur logout untuk semua pemicu (idle, 401 dari REST, 4401 dari WS, logout manual), dijaga SATU KALI per
// pemuatan halaman supaya beberapa pemicu yang datang bersamaan tidak saling menimpa redirect.
// Urutan: signOut dulu (hapus cookie lokal; kalau tidak, /signin bisa dianggap masih login) -> arahkan ke /signin.
let inProgress = false;

// Diisi IdleSessionProvider: true bila deadline idle lokal sudah lewat (supaya 401/4401 yang datang bersamaan
// dengan habisnya idle tampil sebagai "tidak ada aktivitas", bukan "sesi berakhir" generik).
let idleHint: (() => boolean) | null = null;
export function setIdleHint(fn: (() => boolean) | null) {
  idleHint = fn;
}

// Dipanggil UserDropdown sebelum signOut manual: mencegah jalur otomatis menimpa navigasi ke /signin.
export function beginManualLogout() {
  inProgress = true;
}

export async function performLogout(kind: SignInReason | "manual") {
  if (inProgress) return;
  inProgress = true;
  try {
    await signOut({ redirect: false });
  } catch {
    // tetap lanjut ke /signin
  }
  const from = kind === "manual" ? null : `${window.location.pathname}${window.location.search}`;
  window.location.assign(buildSignInUrl({ reason: kind === "manual" ? undefined : kind, from }));
}

// Sinyal dari server bahwa sesi tidak sah (401 REST /api/backend/*, close 4401 + probe 401).
export function logoutFromServerSignal() {
  return performLogout(idleHint?.() ? "idle" : "expired");
}
