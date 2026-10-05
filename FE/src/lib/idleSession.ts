// Controller idle-timeout sesi web TANPA React/DOM/next-auth: semua efek samping (jam, timer, server, dialog, antar-tab,
// logout) disuntikkan sehingga dapat dites dengan jam palsu. Server (BE) adalah otoritas: controller hanya memperkirakan
// sisa waktu dari `remainingSec` yang dihitung server, dan memutuskan logout hanya setelah dikonfirmasi server.
//
// Aturan inti:
//  - HANYA interaksi user (onActivity) yang men-touch server. Request otomatis (polling, WS, refetch) tidak pernah.
//  - touch di-throttle (leading + trailing, default 60 dtk) sehingga `la` server tertinggal <= satu jendela throttle.
//  - jam lokal = monotonik (performance.now) + remainingSec dari server => kebal selisih jam klien/server.
//  - setelah tab tersembunyi / perangkat sleep: ambil ulang remainingSec dari server SEBELUM memutuskan peringatan/logout.
//  - cookie bisa "mundur" (race GET /api/auth/session menimpa cookie dengan klaim lebih lama): bila payload menunjukkan
//    sisa waktu lebih kecil daripada yang seharusnya padahal ada aktivitas baru, langsung touch ulang tanpa throttle.

export type LogoutReason = "idle" | "manual";

export type IdleMessage =
  | { type: "activity" }
  | { type: "touched"; remainingSec: number }
  | { type: "logout"; reason: LogoutReason };

export interface IdleDeps {
  now(): number; // monotonik, ms
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  // Sisa detik menurut server (GET sesi). null = tidak login. Melempar bila jaringan gagal.
  readRemaining(): Promise<number | null>;
  // update() eksplisit: server memajukan deadline. null = sesi sudah tidak sah. Melempar bila jaringan gagal.
  touch(): Promise<number | null>;
  showWarning(secondsLeft: () => number): { close(): void; result: Promise<"stay" | "logout" | "closed"> };
  logout(reason: LogoutReason): void;
  post(message: IdleMessage): void;
}

export interface IdleOptions {
  timeoutSec: number;
  warningSec: number;
  initialRemainingSec: number;
  throttleMs?: number; // default 60_000
  tickMs?: number; // default 1_000
  retryMs?: number; // default 5_000
  stallGapMs?: number; // jeda tick yang dianggap tab ditidurkan / perangkat sleep; default 5_000
}

const REGRESS_SLACK_SEC = 5;

export function createIdleController(deps: IdleDeps, opts: IdleOptions) {
  const throttleMs = opts.throttleMs ?? 60_000;
  const tickMs = opts.tickMs ?? 1_000;
  const retryMs = opts.retryMs ?? 5_000;
  const stallGapMs = opts.stallGapMs ?? 5_000;

  let deadline = deps.now() + opts.initialRemainingSec * 1000;
  let lastActivityAt: number | null = null;
  let lastTouchAt = Number.NEGATIVE_INFINITY;
  let touching = false;
  let rerunTouch = false;
  let activitySinceTouch = false;
  let trailing: unknown = null;
  let tickTimer: unknown = null;
  let retryTimer: unknown = null;
  let warning: { close(): void } | null = null;
  let needsSync = false;
  let syncing = false;
  let confirming = false;
  let stopped = false;
  let loggedOut = false;
  let regressFixedFor: number | null = null;
  let lastTick = deps.now();

  const active = () => !stopped && !loggedOut;

  function clearTimers() {
    for (const t of [trailing, tickTimer, retryTimer]) if (t !== null) deps.clearTimer(t);
    trailing = tickTimer = retryTimer = null;
  }

  function closeWarning() {
    const w = warning;
    warning = null;
    w?.close();
  }

  function doLogout(reason: LogoutReason, broadcast = true) {
    if (loggedOut) return;
    loggedOut = true;
    clearTimers();
    closeWarning();
    if (broadcast) deps.post({ type: "logout", reason });
    deps.logout(reason);
  }

  // Batas bawah sisa waktu yang masuk akal bila ada aktivitas: la server >= aktivitas - throttle.
  function expectedMinRemainingSec(now: number): number | null {
    if (lastActivityAt === null) return null;
    return opts.timeoutSec - (now - lastActivityAt) / 1000 - throttleMs / 1000 - REGRESS_SLACK_SEC;
  }

  // Payload sesi dari sumber mana pun (SessionProvider, sync, hasil touch).
  function acceptPayload(remainingSec: number) {
    const now = deps.now();
    const expectedMin = expectedMinRemainingSec(now);
    if (expectedMin !== null && remainingSec < expectedMin) {
      // Cookie mundur: JANGAN menurunkan deadline lokal; perbaiki di server sekali per aktivitas.
      if (deadline <= now) deadline = now + remainingSec * 1000;
      if (regressFixedFor !== lastActivityAt) {
        regressFixedFor = lastActivityAt;
        void touchNow();
      }
      return;
    }
    deadline = now + remainingSec * 1000;
  }

  async function touchNow() {
    if (!active()) return;
    if (touching) {
      rerunTouch = true;
      return;
    }
    touching = true;
    activitySinceTouch = false;
    try {
      const remaining = await deps.touch();
      if (!active()) return;
      if (remaining === null) {
        doLogout("idle");
        return;
      }
      lastTouchAt = deps.now();
      deadline = lastTouchAt + remaining * 1000;
      deps.post({ type: "touched", remainingSec: remaining });
    } catch {
      // jaringan: coba lagi sebentar lagi bila masih ada aktivitas yang belum tersampaikan
      activitySinceTouch = true;
      if (active() && retryTimer === null) {
        retryTimer = deps.setTimer(() => {
          retryTimer = null;
          if (activitySinceTouch) void touchNow();
        }, retryMs);
      }
    } finally {
      touching = false;
      if (active()) {
        if (rerunTouch) {
          rerunTouch = false;
          void touchNow();
        } else if (activitySinceTouch) {
          scheduleTrailing();
        }
      }
    }
  }

  function scheduleTrailing() {
    if (trailing !== null) return;
    const wait = Math.max(0, lastTouchAt + throttleMs - deps.now());
    trailing = deps.setTimer(() => {
      trailing = null;
      void touchNow();
    }, wait);
  }

  function noteActivity() {
    const now = deps.now();
    lastActivityAt = now;
    regressFixedFor = null;
    closeWarning();
    // Perkirakan konservatif nilai yang akan dikonfirmasi server (la server >= aktivitas - throttle).
    deadline = Math.max(deadline, now + (opts.timeoutSec - throttleMs / 1000) * 1000);
  }

  function openWarning() {
    const handle = deps.showWarning(() => Math.max(0, Math.ceil((deadline - deps.now()) / 1000)));
    warning = handle;
    void handle.result.then((choice) => {
      if (warning !== handle) return; // ditutup oleh kita (aktivitas/logout)
      warning = null;
      if (choice === "stay") controller.onActivity(true);
      else if (choice === "logout") doLogout("manual");
    });
  }

  async function sync() {
    if (syncing || !active()) return;
    syncing = true;
    try {
      const remaining = await deps.readRemaining();
      if (!active()) return;
      if (remaining === null) {
        doLogout("idle");
        return;
      }
      needsSync = false;
      acceptPayload(remaining);
    } catch {
      if (active() && retryTimer === null) {
        retryTimer = deps.setTimer(() => {
          retryTimer = null;
          void sync();
        }, retryMs);
      }
    } finally {
      syncing = false;
    }
  }

  // Deadline lokal terlewati: konfirmasi ke server (touch tab lain mungkin tidak sampai) sebelum logout.
  async function confirmExpiry() {
    if (confirming) return;
    confirming = true;
    try {
      const remaining = await deps.readRemaining();
      if (!active()) return;
      if (remaining === null || remaining <= 0) doLogout("idle");
      else acceptPayload(remaining);
    } catch {
      // jaringan: coba lagi di tick berikutnya; server tetap menolak sesi idle
    } finally {
      confirming = false;
    }
  }

  function tick() {
    tickTimer = null;
    if (!active()) return;
    const now = deps.now();
    if (now - lastTick > stallGapMs) needsSync = true; // timer tertahan: tab tersembunyi / sleep
    lastTick = now;
    if (needsSync) {
      void sync();
    } else {
      const remainingMs = deadline - now;
      if (remainingMs <= 0) void confirmExpiry();
      else if (remainingMs <= opts.warningSec * 1000 && warning === null) openWarning();
    }
    tickTimer = deps.setTimer(tick, tickMs);
  }

  const controller = {
    start() {
      if (tickTimer === null && active()) {
        lastTick = deps.now();
        tickTimer = deps.setTimer(tick, tickMs);
      }
    },
    stop() {
      stopped = true;
      clearTimers();
      closeWarning();
    },
    // Interaksi user di tab ini (klik, ketikan, scroll, sentuhan, pindah halaman). `immediate` = abaikan throttle.
    onActivity(immediate = false) {
      if (!active()) return;
      noteActivity();
      deps.post({ type: "activity" });
      activitySinceTouch = true;
      if (immediate || deps.now() - lastTouchAt >= throttleMs) void touchNow();
      else scheduleTrailing();
    },
    // Payload sesi yang diterima tab ini (SessionProvider). Bukan aktivitas.
    onSession(remainingSec: number) {
      if (active()) acceptPayload(remainingSec);
    },
    // Tab terlihat lagi / online / pageshow: sinkronkan dengan server sebelum memutuskan apa pun.
    onVisible() {
      if (!active()) return;
      needsSync = true;
      void sync();
    },
    handleMessage(message: IdleMessage) {
      if (!active()) return;
      if (message.type === "activity") {
        lastActivityAt = deps.now();
        closeWarning();
        deadline = Math.max(deadline, deps.now() + (opts.timeoutSec - throttleMs / 1000) * 1000);
      } else if (message.type === "touched") {
        lastTouchAt = deps.now();
        deadline = lastTouchAt + message.remainingSec * 1000;
        closeWarning();
      } else {
        doLogout(message.reason, false);
      }
    },
    // Logout manual dari tab ini (UserDropdown): siarkan ke tab lain.
    announceLogout(reason: LogoutReason = "manual") {
      if (!loggedOut) deps.post({ type: "logout", reason });
    },
    // untuk tes
    deadlineMs: () => deadline,
    isWarningOpen: () => warning !== null,
  };
  return controller;
}

export type IdleController = ReturnType<typeof createIdleController>;
