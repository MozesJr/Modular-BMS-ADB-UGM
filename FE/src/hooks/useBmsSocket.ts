"use client";
import { useEffect, useRef } from "react";
import type { BmsUpdatePayload } from "@/types/device";

// Normalisasi: buang slash ganda di path (mis. env keliru "…:4000//ws") yang membuat
// browser mengirim target "//ws" → server salah baca path → koneksi ditolak.
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

type WsMessage = { event: string; payload: unknown; ts: number };

// Satu koneksi WS ke backend (/ws), broadcast semua "bms:update" dari SEMUA device
// (backend belum ada per-device subscription) — filter di caller pakai deviceId.
export function useBmsSocket(onUpdate: (payload: BmsUpdatePayload) => void) {
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  });

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let attempt = 0;

    function connect() {
      if (cancelled) return;
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        attempt = 0; // reset backoff setelah koneksi sukses
      };

      ws.onmessage = (ev) => {
        try {
          const msg: WsMessage = JSON.parse(ev.data);
          if (msg.event === "bms:update") {
            onUpdateRef.current(msg.payload as BmsUpdatePayload);
          }
        } catch (err) {
          console.error("[ws] failed parsing message", err);
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        // Backoff eksponensial + jitter supaya tak membanjiri backend saat down.
        const delay = Math.min(BASE_RECONNECT_MS * 2 ** attempt, MAX_RECONNECT_MS);
        const jitter = Math.random() * 0.3 * delay;
        attempt += 1;
        reconnectTimer = setTimeout(connect, delay + jitter);
      };

      ws.onerror = () => {
        ws?.close();
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);
}
