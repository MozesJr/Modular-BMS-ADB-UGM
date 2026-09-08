"use client";
import { useEffect, useRef } from "react";
import type { BmsUpdatePayload } from "@/types/device";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000/ws";
const RECONNECT_DELAY_MS = 2000;

type WsMessage = { event: string; payload: unknown; ts: number };

// Satu koneksi WS ke backend (/ws), broadcast semua "bms:update" event dari SEMUA device
// (backend belum ada per-device subscription) — filter di sisi caller pakai deviceId.
export function useBmsSocket(onUpdate: (payload: BmsUpdatePayload) => void) {
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  });

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      ws = new WebSocket(WS_URL);

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
        if (!cancelled) reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
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
