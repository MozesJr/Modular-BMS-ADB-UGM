import { beforeEach, describe, expect, it } from "vitest";
import {
  createWsController,
  MAX_REFUSED_ATTEMPTS,
  QUICK_4401_WINDOW_MS,
  type SessionProbe,
  type SocketLike,
  type WsStatus,
} from "./wsController";

// Semua efek samping (socket, probe, timer) fake; dijalankan dengan `npm test` di FE.
class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.();
  }
  closeWith(code: number) {
    this.onclose?.({ code });
  }
}

let sockets: FakeSocket[];
let statuses: WsStatus[];
let probes: SessionProbe[]; // jawaban probe berikutnya (antrean)
let probeCalls: number;
let unauthenticated: number;
let timers: { fn: () => void; ms: number }[];
let clock: number;

function make() {
  return createWsController({
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    probe: async () => {
      probeCalls += 1;
      return probes.shift() ?? "unreachable";
    },
    onStatus: (s) => statuses.push(s),
    onMessage: () => {},
    onUnauthenticated: () => {
      unauthenticated += 1;
    },
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length - 1;
    },
    clearTimer: () => {},
    now: () => clock,
    random: () => 0,
  });
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const last = () => sockets[sockets.length - 1];

beforeEach(() => {
  sockets = [];
  statuses = [];
  probes = [];
  probeCalls = 0;
  unauthenticated = 0;
  timers = [];
  clock = 1_000_000;
});

describe("close 4401: probe dulu sebelum signOut", () => {
  it("probe 401 -> signOut/redirect (onUnauthenticated) dan berhenti, tidak reconnect", async () => {
    const c = make();
    c.start();
    last().open();
    probes = ["unauthenticated"];
    last().closeWith(4401);
    await flush();
    expect(probeCalls).toBe(1);
    expect(unauthenticated).toBe(1);
    expect(sockets).toHaveLength(1);
    expect(timers).toHaveLength(0);
  });

  it("probe 200 -> sambung ulang SEKALI tanpa signOut", async () => {
    const c = make();
    c.start();
    last().open();
    probes = ["authenticated"];
    last().closeWith(4401);
    await flush();
    expect(unauthenticated).toBe(0);
    expect(sockets).toHaveLength(2); // langsung disambung ulang
    last().open();
    expect(statuses[statuses.length - 1]).toBe("connected");
  });

  it("probe 200 lalu 4401 lagi dalam waktu singkat -> berhenti 'rejected', tanpa probe/loop/signOut", async () => {
    const c = make();
    c.start();
    last().open();
    probes = ["authenticated", "authenticated"];
    last().closeWith(4401);
    await flush();
    expect(sockets).toHaveLength(2);

    clock += QUICK_4401_WINDOW_MS - 1;
    last().open();
    last().closeWith(4401);
    await flush();
    expect(statuses[statuses.length - 1]).toBe("rejected");
    expect(sockets).toHaveLength(2);
    expect(probeCalls).toBe(1);
    expect(unauthenticated).toBe(0);
    expect(timers).toHaveLength(0);
  });

  it("4401 setelah jendela singkat lewat diperlakukan sebagai kejadian baru (probe lagi)", async () => {
    const c = make();
    c.start();
    last().open();
    probes = ["authenticated", "unauthenticated"];
    last().closeWith(4401);
    await flush();
    clock += QUICK_4401_WINDOW_MS + 1;
    last().open();
    last().closeWith(4401);
    await flush();
    expect(probeCalls).toBe(2);
    expect(unauthenticated).toBe(1);
  });

  it("probe gagal (jaringan/5xx) -> backoff biasa, tanpa signOut", async () => {
    const c = make();
    c.start();
    last().open();
    probes = ["unreachable"];
    last().closeWith(4401);
    await flush();
    expect(unauthenticated).toBe(0);
    expect(sockets).toHaveLength(1);
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(1000); // backoff pertama
    expect(statuses[statuses.length - 1]).toBe("disconnected");

    timers[0].fn(); // timer berjalan -> reconnect
    expect(sockets).toHaveLength(2);
  });
});

describe("perilaku lama tidak berubah", () => {
  it("putus biasa (1006) setelah terbuka -> reconnect dengan backoff, tanpa probe", async () => {
    const c = make();
    c.start();
    last().open();
    last().closeWith(1006);
    await flush();
    expect(probeCalls).toBe(0);
    expect(timers).toHaveLength(1);
  });

  it("handshake gagal + probe 401 -> signOut/redirect", async () => {
    const c = make();
    c.start();
    probes = ["unauthenticated"];
    last().closeWith(1006);
    await flush();
    expect(unauthenticated).toBe(1);
  });

  it("handshake gagal berulang padahal sesi valid -> berhenti 'rejected' setelah batas", async () => {
    const c = make();
    c.start();
    for (let i = 0; i < MAX_REFUSED_ATTEMPTS; i += 1) {
      probes = ["authenticated"];
      last().closeWith(1006);
      await flush();
      if (i < MAX_REFUSED_ATTEMPTS - 1) timers[timers.length - 1].fn();
    }
    expect(statuses[statuses.length - 1]).toBe("rejected");
    expect(sockets).toHaveLength(MAX_REFUSED_ATTEMPTS);
  });

  it("stop() menutup socket dan mencegah sambung ulang; retry() memulai lagi", async () => {
    const c = make();
    c.start();
    last().open();
    c.stop("client signing out");
    expect(sockets[0].closed).toBe(true);
    sockets[0].closeWith(1000);
    await flush();
    expect(timers).toHaveLength(0);
    c.retry();
    expect(sockets).toHaveLength(2);
  });
});
