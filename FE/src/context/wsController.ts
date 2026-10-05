// Logika koneksi WS tanpa React/next-auth: semua efek samping (socket, probe, timer) disuntikkan sehingga bisa dites.
// WsContext.tsx hanya membungkusnya dengan state React. Lihat komentar di WsContext.tsx untuk kontrak dengan server.
export type WsStatus = "connecting" | "connected" | "disconnected" | "rejected";
export type SessionProbe = "unauthenticated" | "authenticated" | "unreachable";

export const WS_CLOSE_UNAUTHENTICATED = 4401;
export const BASE_RECONNECT_MS = 1000;
export const MAX_RECONNECT_MS = 30_000;
// Handshake gagal berturut-turut padahal server terjangkau dan sesi valid -> berhenti.
export const MAX_REFUSED_ATTEMPTS = 3;
// Koneksi yang disambung ulang karena 4401-tapi-sesi-masih-sah dan ditutup 4401 lagi dalam jendela ini = loop -> berhenti.
export const QUICK_4401_WINDOW_MS = 10_000;

export interface SocketLike {
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: (() => void) | null;
  close(code?: number, reason?: string): void;
}

export interface WsControllerDeps {
  createSocket(): SocketLike;
  probe(): Promise<SessionProbe>;
  onStatus(status: WsStatus): void;
  onMessage(data: string): void;
  // Sesi terbukti tidak sah (probe 401): bersihkan cookie lokal lalu arahkan ke /signin.
  onUnauthenticated(): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  now(): number;
  random(): number;
}

export function createWsController(deps: WsControllerDeps) {
  let socket: SocketLike | null = null;
  let timer: unknown = null;
  let stopped = false; // unmount, logout, atau berhenti karena ditolak
  let attempt = 0;
  let refused = 0;
  let reconnectedAfter4401At: number | null = null;

  function clearReconnect() {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  }

  function scheduleReconnect() {
    const delay = Math.min(BASE_RECONNECT_MS * 2 ** attempt, MAX_RECONNECT_MS);
    const jitter = deps.random() * 0.3 * delay;
    attempt += 1;
    deps.onStatus("disconnected");
    timer = deps.setTimer(connect, delay + jitter);
  }

  function giveUp(status: WsStatus) {
    stopped = true;
    deps.onStatus(status);
  }

  async function handleHandshakeFailure() {
    const probe = await deps.probe();
    if (stopped) return;
    if (probe === "unauthenticated") {
      giveUp("disconnected");
      deps.onUnauthenticated();
      return;
    }
    if (probe === "authenticated") {
      refused += 1;
      if (refused >= MAX_REFUSED_ATTEMPTS) {
        giveUp("rejected");
        return;
      }
    }
    // "unreachable" = jaringan/server mati: backoff biasa tanpa batas.
    scheduleReconnect();
  }

  // Server menutup dengan 4401. Jangan langsung signOut: JWT bisa saja sudah diperpanjang Auth.js sementara koneksi
  // memegang exp lama. Tanyakan dulu ke probe.
  async function handleUnauthenticatedClose() {
    const now = deps.now();
    if (reconnectedAfter4401At !== null && now - reconnectedAfter4401At < QUICK_4401_WINDOW_MS) {
      giveUp("rejected"); // sudah disambung ulang sekali dan langsung ditutup lagi: jangan loop
      return;
    }
    deps.onStatus("disconnected");
    const probe = await deps.probe();
    if (stopped) return;
    if (probe === "unauthenticated") {
      giveUp("disconnected");
      deps.onUnauthenticated();
    } else if (probe === "authenticated") {
      reconnectedAfter4401At = deps.now();
      connect(); // sesi masih sah: sambung ulang SEKALI tanpa signOut
    } else {
      scheduleReconnect(); // jaringan/5xx: backoff biasa
    }
  }

  function connect() {
    if (stopped) return;
    timer = null;
    deps.onStatus("connecting");
    const s = deps.createSocket();
    socket = s;
    let opened = false;

    s.onopen = () => {
      opened = true;
      attempt = 0;
      refused = 0;
      deps.onStatus("connected");
    };
    s.onmessage = (ev) => deps.onMessage(ev.data);
    s.onclose = (ev) => {
      if (stopped || socket !== s) return;
      if (ev.code === WS_CLOSE_UNAUTHENTICATED) {
        void handleUnauthenticatedClose();
        return;
      }
      if (!opened) {
        // Handshake ditolak/gagal (browser hanya melihat 1006): cari tahu penyebabnya.
        deps.onStatus("disconnected");
        void handleHandshakeFailure();
        return;
      }
      scheduleReconnect(); // koneksi yang sempat terbuka lalu putus: reconnect dengan backoff
    };
    s.onerror = () => s.close();
  }

  return {
    start: connect,
    // Logout / unmount: tutup eksplisit dan jangan sambung lagi.
    stop(closeReason?: string) {
      stopped = true;
      clearReconnect();
      socket?.close(closeReason ? 1000 : undefined, closeReason);
    },
    // Setelah "rejected": mulai lagi dari awal.
    retry() {
      clearReconnect();
      stopped = false;
      attempt = 0;
      refused = 0;
      reconnectedAfter4401At = null;
      connect();
    },
  };
}
