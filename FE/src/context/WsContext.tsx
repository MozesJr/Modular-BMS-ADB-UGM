"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { BmsUpdatePayload } from "@/types/device";

// SATU koneksi WS untuk seluruh app (dulu tiap komponen buka sendiri). Menyediakan status
// koneksi global (untuk indikator header) + subscribe ke event "bms:update".
export type WsStatus = "connecting" | "connected" | "disconnected";
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
const BASE_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30_000;

type WsContextValue = { status: WsStatus; subscribe: (l: Listener) => () => void };
const WsContext = createContext<WsContextValue>({ status: "connecting", subscribe: () => () => {} });

export function WsProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<WsStatus>("connecting");
  const listeners = useRef(new Set<Listener>());

  const subscribe = useCallback((l: Listener) => {
    listeners.current.add(l);
    return () => {
      listeners.current.delete(l);
    };
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let attempt = 0;

    function connect() {
      if (cancelled) return;
      setStatus((s) => (attempt === 0 ? "connecting" : "connecting"));
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        attempt = 0;
        setStatus("connected");
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as { event: string; payload: unknown };
          if (msg.event === "bms:update") {
            const payload = msg.payload as BmsUpdatePayload;
            listeners.current.forEach((l) => l(payload));
          }
        } catch (err) {
          console.error("[ws] failed parsing message", err);
        }
      };
      ws.onclose = () => {
        if (cancelled) return;
        setStatus("disconnected");
        const delay = Math.min(BASE_RECONNECT_MS * 2 ** attempt, MAX_RECONNECT_MS);
        const jitter = Math.random() * 0.3 * delay;
        attempt += 1;
        setStatus("connecting");
        reconnectTimer = setTimeout(connect, delay + jitter);
      };
      ws.onerror = () => ws?.close();
    }

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  return <WsContext.Provider value={{ status, subscribe }}>{children}</WsContext.Provider>;
}

export function useWsStatus(): WsStatus {
  return useContext(WsContext).status;
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
