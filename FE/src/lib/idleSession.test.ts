import { describe, expect, it } from "vitest";
import { createIdleController, type IdleDeps, type IdleMessage, type LogoutReason } from "./idleSession";

// Jam dan timer palsu; semua efek samping disuntikkan. timeout 120 dtk, peringatan 30 dtk, throttle 60 dtk.
const TIMEOUT = 120;
const WARNING = 30;

const flush = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

class Clock {
  t = 0;
  private timers: { id: number; at: number; fn: () => void }[] = [];
  private seq = 0;
  setTimer = (fn: () => void, ms: number) => {
    const id = ++this.seq;
    this.timers.push({ id, at: this.t + ms, fn });
    return id;
  };
  clearTimer = (h: unknown) => {
    this.timers = this.timers.filter((x) => x.id !== h);
  };
  // maju selangkah demi selangkah supaya timer berjalan berurutan
  async advance(ms: number) {
    const target = this.t + ms;
    for (;;) {
      const next = this.timers.filter((x) => x.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.timers = this.timers.filter((x) => x !== next);
      this.t = Math.max(this.t, next.at);
      next.fn();
      await flush();
    }
    this.t = target;
    await flush();
  }
  // perangkat sleep: jam melompat tanpa timer sempat jalan, lalu satu tick berikutnya terjadi
  async jump(ms: number) {
    this.t += ms;
    const due = this.timers.filter((x) => x.at <= this.t).sort((a, b) => a.at - b.at);
    for (const next of due) {
      this.timers = this.timers.filter((x) => x !== next);
      next.fn();
      await flush();
    }
  }
}

interface Server {
  readResults: (number | null | "fail")[]; // antrean jawaban readRemaining; kosong -> sisa default
  touchResults: (number | null | "fail")[];
  defaultRemaining: number;
  reads: number;
  touches: number;
}

function make(initial = TIMEOUT, bus?: { peers: ReturnType<typeof make>[] }) {
  const clock = new Clock();
  const server: Server = { readResults: [], touchResults: [], defaultRemaining: TIMEOUT, reads: 0, touches: 0 };
  const logs: LogoutReason[] = [];
  const posted: IdleMessage[] = [];
  const warnings: { closed: boolean; resolve: (r: "stay" | "logout" | "closed") => void; secondsLeft: () => number }[] = [];

  const answer = async (queue: (number | null | "fail")[], fallback: number) => {
    const next = queue.length > 0 ? queue.shift()! : fallback;
    if (next === "fail") throw new Error("network");
    return next;
  };

  const deps: IdleDeps = {
    now: () => clock.t,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    readRemaining: async () => {
      server.reads += 1;
      return answer(server.readResults, server.defaultRemaining);
    },
    touch: async () => {
      server.touches += 1;
      return answer(server.touchResults, TIMEOUT);
    },
    showWarning: (secondsLeft) => {
      let resolve!: (r: "stay" | "logout" | "closed") => void;
      const result = new Promise<"stay" | "logout" | "closed">((r) => (resolve = r));
      const w = { closed: false, resolve, secondsLeft };
      warnings.push(w);
      return {
        close: () => {
          w.closed = true;
          resolve("closed");
        },
        result,
      };
    },
    logout: (reason) => logs.push(reason),
    post: (m) => {
      posted.push(m);
      for (const peer of bus?.peers ?? []) peer.controller.handleMessage(m);
    },
  };
  const controller = createIdleController(deps, { timeoutSec: TIMEOUT, warningSec: WARNING, initialRemainingSec: initial });
  return { clock, server, logs, posted, warnings, controller };
}

describe("peringatan dan logout", () => {
  it("peringatan muncul tepat pada batas - warningSec, bukan lebih awal", async () => {
    const c = make();
    c.controller.start();
    await c.clock.advance((TIMEOUT - WARNING) * 1000 - 1500);
    expect(c.warnings).toHaveLength(0);
    await c.clock.advance(2500);
    expect(c.warnings).toHaveLength(1);
    expect(c.warnings[0].secondsLeft()).toBeLessThanOrEqual(WARNING);
    expect(c.warnings[0].secondsLeft()).toBeGreaterThan(WARNING - 4);
  });

  it("tanpa aktivitas: logout idle setelah batas, dikonfirmasi server", async () => {
    const c = make();
    c.server.defaultRemaining = 0;
    c.controller.start();
    await c.clock.advance(TIMEOUT * 1000 + 2000);
    expect(c.logs).toEqual(["idle"]);
    expect(c.server.reads).toBeGreaterThanOrEqual(1);
    expect(c.server.touches).toBe(0);
  });

  it("jika server bilang masih ada sisa (touch tab lain tak sampai), tidak logout dan deadline mengikuti server", async () => {
    const c = make();
    c.server.readResults = [90];
    c.controller.start();
    await c.clock.advance(TIMEOUT * 1000 + 2000);
    expect(c.logs).toEqual([]);
    expect(c.controller.deadlineMs()).toBeGreaterThan(c.clock.t + 80_000);
  });

  it("tombol 'Tetap login' men-touch server segera; 'Keluar' logout manual", async () => {
    const c = make();
    c.controller.start();
    await c.clock.advance((TIMEOUT - WARNING) * 1000 + 1500);
    c.warnings[0].resolve("stay");
    await flush();
    expect(c.server.touches).toBe(1);
    expect(c.controller.isWarningOpen()).toBe(false);

    const d = make();
    d.controller.start();
    await d.clock.advance((TIMEOUT - WARNING) * 1000 + 1500);
    d.warnings[0].resolve("logout");
    await flush();
    expect(d.logs).toEqual(["manual"]);
  });

  it("touch dijawab 'tidak login' -> logout idle", async () => {
    const c = make();
    c.server.touchResults = [null];
    c.controller.start();
    c.controller.onActivity();
    await flush();
    expect(c.logs).toEqual(["idle"]);
  });
});

describe("aktivitas memperpanjang, request otomatis tidak", () => {
  it("aktivitas men-touch server (leading) dan memajukan deadline; peringatan tidak muncul selama aktif", async () => {
    const c = make();
    c.controller.start();
    await c.clock.advance(60_000);
    c.controller.onActivity();
    await flush();
    expect(c.server.touches).toBe(1);
    expect(c.controller.deadlineMs()).toBe(c.clock.t + TIMEOUT * 1000);
    await c.clock.advance((TIMEOUT - WARNING) * 1000 - 5000); // sudah lewat 90 dtk sejak awal, tapi aktivitas menggeser
    expect(c.warnings).toHaveLength(0);
  });

  it("throttle leading + trailing: banyak interaksi dalam 60 dtk = 1 touch langsung + 1 touch di ujung jendela", async () => {
    const c = make();
    c.controller.start();
    c.controller.onActivity(); // leading
    await flush();
    expect(c.server.touches).toBe(1);
    for (let i = 0; i < 20; i += 1) {
      await c.clock.advance(1000);
      c.controller.onActivity();
    }
    expect(c.server.touches).toBe(1); // masih dalam jendela throttle
    await c.clock.advance(41_000);
    expect(c.server.touches).toBe(2); // trailing tepat di 60 dtk sejak touch pertama
    await c.clock.advance(120_000 - 1000);
    expect(c.server.touches).toBe(2); // tanpa aktivitas baru tidak ada touch lagi
  });

  it("request otomatis (payload sesi dari polling/refetch) tidak pernah men-touch dan tidak menggeser deadline", async () => {
    const c = make();
    c.controller.start();
    const before = c.controller.deadlineMs();
    for (let s = 10; s < 100; s += 10) {
      await c.clock.advance(10_000);
      c.controller.onSession(TIMEOUT - s); // payload yang konsisten dengan waktu berjalan (tanpa aktivitas)
    }
    expect(c.server.touches).toBe(0);
    expect(Math.abs(c.controller.deadlineMs() - before)).toBeLessThan(2000);
    await c.clock.advance(40_000);
    expect(c.warnings).toHaveLength(1); // peringatan tetap muncul walau "polling" berjalan
  });
});

describe("cookie mundur (race GET /api/auth/session)", () => {
  it("payload stale dengan sisa terlalu kecil padahal baru ada aktivitas -> touch ulang segera tanpa menunggu throttle", async () => {
    const c = make();
    c.controller.start();
    c.controller.onActivity();
    await flush();
    expect(c.server.touches).toBe(1);

    await c.clock.advance(5000); // masih di dalam jendela throttle
    c.controller.onSession(8); // cookie mundur ke la yang sudah lama
    await flush();
    expect(c.server.touches).toBe(2); // tidak menunggu 60 dtk
    expect(c.controller.deadlineMs()).toBeGreaterThan(c.clock.t + (TIMEOUT - 5) * 1000); // deadline lokal tidak diturunkan/dipulihkan
  });

  it("tidak loop: payload stale berulang untuk aktivitas yang sama hanya memicu satu perbaikan", async () => {
    const c = make();
    c.controller.start();
    c.controller.onActivity();
    await flush();
    await c.clock.advance(2000);
    c.controller.onSession(5);
    await flush();
    c.controller.onSession(5);
    c.controller.onSession(4);
    await flush();
    expect(c.server.touches).toBe(2);
    c.controller.onActivity(); // aktivitas baru boleh memicu perbaikan baru
    await c.clock.advance(1000);
    c.controller.onSession(3);
    await flush();
    expect(c.server.touches).toBeGreaterThanOrEqual(3);
  });

  it("sisa kecil TANPA aktivitas baru adalah normal (bukan regresi): tidak ada touch", async () => {
    const c = make();
    c.controller.start();
    await c.clock.advance(100_000);
    c.controller.onSession(20);
    await flush();
    expect(c.server.touches).toBe(0);
  });
});

describe("tab tersembunyi / sleep: sinkron ulang dari server sebelum memutuskan", () => {
  it("setelah sleep panjang server masih memberi sisa besar -> tidak logout dan tidak ada peringatan", async () => {
    const c = make();
    c.controller.start();
    c.server.readResults = [100];
    await c.clock.jump(40 * 60 * 1000); // jam lokal melompat jauh melewati deadline lokal
    expect(c.server.reads).toBe(1); // bertanya dulu ke server
    expect(c.logs).toEqual([]);
    expect(c.warnings).toHaveLength(0);
  });

  it("sleep singkat yang membawa jam lokal ke zona peringatan: tidak ada peringatan sebelum server menjawab (server: masih lama)", async () => {
    const c = make();
    c.controller.start();
    c.server.readResults = [100];
    await c.clock.jump(95_000); // deadline lokal tinggal 25 dtk (< peringatan 30) hanya karena jam melompat
    expect(c.server.reads).toBe(1);
    expect(c.warnings).toHaveLength(0);
    await c.clock.advance(3000);
    expect(c.warnings).toHaveLength(0);
  });

  it("setelah sleep server bilang tidak login -> logout idle", async () => {
    const c = make();
    c.controller.start();
    c.server.readResults = [null];
    await c.clock.jump(40 * 60 * 1000);
    expect(c.logs).toEqual(["idle"]);
  });

  it("setelah sleep sisa kecil (< warning) -> peringatan muncul berdasar sisa SERVER", async () => {
    const c = make();
    c.controller.start();
    c.server.readResults = [20];
    await c.clock.jump(40 * 60 * 1000);
    await c.clock.advance(1500);
    expect(c.logs).toEqual([]);
    expect(c.warnings).toHaveLength(1);
    expect(c.warnings[0].secondsLeft()).toBeLessThanOrEqual(20);
  });

  it("tab kembali terlihat (onVisible) -> baca server dulu; gagal jaringan -> coba lagi, tidak logout", async () => {
    const c = make();
    c.controller.start();
    c.server.readResults = ["fail", 100];
    c.controller.onVisible();
    await flush();
    expect(c.logs).toEqual([]);
    expect(c.server.reads).toBe(1);
    await c.clock.advance(5_500);
    expect(c.server.reads).toBeGreaterThanOrEqual(2);
    expect(c.logs).toEqual([]);
  });

  it("selama menunggu sinkron (needsSync) tidak ada keputusan dari jam lokal", async () => {
    const c = make();
    c.controller.start();
    c.server.readResults = ["fail", "fail", "fail"];
    await c.clock.advance((TIMEOUT + 10) * 1000 - 100_000); // dekat deadline
    c.controller.onVisible();
    await c.clock.advance(1500);
    expect(c.warnings).toHaveLength(0);
    expect(c.logs).toEqual([]);
  });
});

describe("sinkronisasi antar-tab", () => {
  function pair() {
    const bus = { peers: [] as ReturnType<typeof make>[] };
    const a = make(TIMEOUT, bus);
    const b = make(TIMEOUT, bus);
    // pesan dari A hanya ke B dan sebaliknya
    bus.peers = [];
    const aPosts = a.posted;
    const origA = a.controller;
    return { a, b, aPosts, origA };
  }

  it("aktivitas di tab A menjaga tab B tetap login: peringatan di B ditutup dan deadline B maju", async () => {
    const { a, b } = pair();
    a.controller.start();
    b.controller.start();
    await b.clock.advance((TIMEOUT - WARNING) * 1000 + 1500);
    expect(b.warnings).toHaveLength(1);

    a.controller.onActivity();
    await flush();
    // kirim pesan A -> B (yang diposting A)
    for (const m of a.posted) b.controller.handleMessage(m);
    expect(b.controller.isWarningOpen()).toBe(false);
    expect(b.warnings[0].closed).toBe(true);
    expect(b.controller.deadlineMs()).toBeGreaterThan(b.clock.t + (TIMEOUT - WARNING) * 1000);
    expect(b.server.touches).toBe(0); // hanya tab aktif yang men-touch
    expect(a.server.touches).toBe(1);
    expect(a.posted.some((m) => m.type === "touched")).toBe(true);
  });

  it("logout di satu tab me-logout tab lain tanpa menyiarkan ulang", async () => {
    const { a, b } = pair();
    a.controller.start();
    b.controller.start();
    a.controller.announceLogout("manual");
    for (const m of a.posted) b.controller.handleMessage(m);
    expect(b.logs).toEqual(["manual"]);
    expect(b.posted.filter((m) => m.type === "logout")).toHaveLength(0);
  });

  it("logout idle di tab A disiarkan; tab B ikut logout dengan alasan yang sama", async () => {
    const { a, b } = pair();
    a.server.defaultRemaining = 0;
    a.controller.start();
    b.controller.start();
    await a.clock.advance((TIMEOUT + 3) * 1000);
    expect(a.logs).toEqual(["idle"]);
    for (const m of a.posted) b.controller.handleMessage(m);
    expect(b.logs).toEqual(["idle"]);
  });
});
