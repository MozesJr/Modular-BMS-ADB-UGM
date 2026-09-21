// State proses yang harus terlihat oleh DUA "dunia" modul di proses yang sama:
//   - kode custom server (dikompilasi tsc ke dist/, mis. mqtt/client.ts)
//   - route handler Next.js (di-bundle webpack, mis. /api/health)
// Keduanya punya salinan modul sendiri, jadi state disimpan di globalThis.
export interface RuntimeState {
  startedAt: number;
  shuttingDown: boolean;
  mqtt: {
    connected: boolean;
    lastConnectAt: number | null;
    lastMessageAt: number | null;
  };
  counters: Record<string, number>;
}

const KEY = Symbol.for("bms.runtime");
type GlobalWithState = typeof globalThis & { [KEY]?: RuntimeState };

export function runtime(): RuntimeState {
  const g = globalThis as GlobalWithState;
  if (!g[KEY]) {
    g[KEY] = {
      startedAt: Date.now(),
      shuttingDown: false,
      mqtt: { connected: false, lastConnectAt: null, lastMessageAt: null },
      counters: {},
    };
  }
  return g[KEY]!;
}

export function incr(name: string, by = 1) {
  const c = runtime().counters;
  c[name] = (c[name] ?? 0) + by;
}
