import type { IdleMessage } from "@/lib/idleSession";

// Sinkronisasi antar-tab: BroadcastChannel, dengan cadangan event "storage" (localStorage) bila tidak tersedia.
const NAME = "bms-idle";
const STORAGE_KEY = "bms-idle-msg";

function parse(value: unknown): IdleMessage | null {
  if (typeof value !== "object" || value === null || !("type" in value)) return null;
  const v = value as { type: unknown; remainingSec?: unknown; reason?: unknown };
  if (v.type === "activity") return { type: "activity" };
  if (v.type === "touched" && typeof v.remainingSec === "number" && Number.isFinite(v.remainingSec)) {
    return { type: "touched", remainingSec: v.remainingSec };
  }
  if (v.type === "logout") return { type: "logout", reason: v.reason === "idle" ? "idle" : "manual" };
  return null;
}

export function postIdleMessage(message: IdleMessage): void {
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const ch = new BroadcastChannel(NAME);
      ch.postMessage(message);
      ch.close();
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...message, n: Math.random() }));
    }
  } catch {
    // tanpa sinkronisasi antar-tab; server tetap otoritatif
  }
}

export function openIdleChannel(onMessage: (m: IdleMessage) => void): { post: (m: IdleMessage) => void; close: () => void } {
  if (typeof BroadcastChannel !== "undefined") {
    const ch = new BroadcastChannel(NAME);
    ch.onmessage = (ev: MessageEvent) => {
      const m = parse(ev.data);
      if (m) onMessage(m);
    };
    return { post: (m) => ch.postMessage(m), close: () => ch.close() };
  }
  const onStorage = (ev: StorageEvent) => {
    if (ev.key !== STORAGE_KEY || !ev.newValue) return;
    try {
      const m = parse(JSON.parse(ev.newValue));
      if (m) onMessage(m);
    } catch {
      // abaikan
    }
  };
  window.addEventListener("storage", onStorage);
  return {
    post: (m) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...m, n: Math.random() }));
      } catch {
        // abaikan
      }
    },
    close: () => window.removeEventListener("storage", onStorage),
  };
}
