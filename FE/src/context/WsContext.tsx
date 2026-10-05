"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import type { BmsUpdatePayload } from "@/types/device";
import { createWsController, type SessionProbe, type SocketLike, type WsStatus } from "@/context/wsController";

// SATU koneksi WS untuk seluruh app (dulu tiap komponen buka sendiri). Menyediakan status
// koneksi global (untuk indikator header) + subscribe ke event "bms:update".
//
// Autentikasi: cookie sesi Auth.js ikut otomatis pada handshake (same-site), tanpa token di URL. Server menolak
// handshake tanpa sesi valid (401) / Origin tidak terdaftar (403) / terlalu banyak koneksi (429) SEBELUM handshake,
// dan menutup koneksi dengan kode 4401 bila sesi berakhir. Browser tidak bisa membaca status HTTP dari upgrade yang
// gagal (hanya close 1006), jadi penyebabnya dibedakan dengan probe ke endpoint yang sudah ada (lihat probeSession).
//   "rejected" = server dapat dijangkau & sesi valid, tetapi WS ditolak berulang -> BERHENTI mencoba, tampilkan
//                "realtime terputus" (ada tombol coba lagi). Putus jaringan biasa tetap reconnect dengan backoff.
export type { WsStatus };
type Listener = (payload: BmsUpdatePayload) => void;

function normalizeWsUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.pathname = u.pathname.replace(/\/{2,}/g, "/");
    return u.toString();
  } catch {
    return raw;
  }
}

const WS_URL = normalizeWsUrl(process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000/ws");
// GET /api/v1/me (sudah ada; lewat rewrite FE -> BE) membedakan login dari tidak login: 200 vs 401.
// /api/auth/session TIDAK dipakai karena membalas 200 walau tanpa sesi.
async function probeSession(): Promise<SessionProbe> {
  try {
    const res = await fetch("/api/v1/me", { credentials: "same-origin", cache: "no-store" });
    if (res.status === 401) return "unauthenticated";
    return res.ok ? "authenticated" : "unreachable";
  } catch {
    return "unreachable";
  }
}

// Sesi tidak lagi valid di server: bersihkan cookie lokal dulu (kalau tidak, proxy FE masih menganggap login dan
// /signin memantul balik ke "/" -> loop), lalu arahkan ke /signin.
async function redirectToSignIn() {
  try {
    await signOut({ redirect: false });
  } catch {
    // tetap lanjut ke /signin
  }
  window.location.assign("/signin?reason=expired");
}

type WsContextValue = {
  status: WsStatus;
  subscribe: (l: Listener) => () => void;
  // Tutup socket secara eksplisit dan jangan sambung lagi (dipanggil saat logout).
  disconnect: () => void;
  // Mulai lagi setelah status "rejected".
  retry: () => void;
};
const WsContext = createContext<WsContextValue>({
  status: "connecting",
  subscribe: () => () => {},
  disconnect: () => {},
  retry: () => {},
});

export function WsProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<WsStatus>("connecting");
  const listeners = useRef(new Set<Listener>());
  const controls = useRef<{ disconnect: () => void; retry: () => void }>({ disconnect: () => {}, retry: () => {} });

  const subscribe = useCallback((l: Listener) => {
    listeners.current.add(l);
    return () => {
      listeners.current.delete(l);
    };
  }, []);
  const disconnect = useCallback(() => controls.current.disconnect(), []);
  const retry = useCallback(() => controls.current.retry(), []);

  useEffect(() => {
    const controller = createWsController({
      createSocket: () => new WebSocket(WS_URL) as unknown as SocketLike,
      probe: probeSession,
      onStatus: setStatus,
      onMessage: (data) => {
        try {
          const msg = JSON.parse(data) as { event: string; payload: unknown };
          if (msg.event === "bms:update") {
            const payload = msg.payload as BmsUpdatePayload;
            listeners.current.forEach((l) => l(payload));
          }
        } catch (err) {
          console.error("[ws] failed parsing message", err);
        }
      },
      onUnauthenticated: () => void redirectToSignIn(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      now: () => Date.now(),
      random: Math.random,
    });

    controls.current = {
      disconnect: () => {
        controller.stop("client signing out");
        setStatus("disconnected");
      },
      retry: controller.retry,
    };

    controller.start();
    return () => controller.stop();
  }, []);

  return <WsContext.Provider value={{ status, subscribe, disconnect, retry }}>{children}</WsContext.Provider>;
}

export function useWsStatus(): WsStatus {
  return useContext(WsContext).status;
}

export function useWsControls(): { disconnect: () => void; retry: () => void } {
  const { disconnect, retry } = useContext(WsContext);
  return { disconnect, retry };
}

// Kompat: subscribe ke bms:update via koneksi bersama.
export function useBmsSocket(onUpdate: Listener) {
  const { subscribe } = useContext(WsContext);
  const ref = useRef(onUpdate);
  useEffect(() => {
    ref.current = onUpdate;
  });
  useEffect(() => subscribe((p) => ref.current(p)), [subscribe]);
}
