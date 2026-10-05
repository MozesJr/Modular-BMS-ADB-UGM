"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { showIdleWarning } from "@/lib/alerts";
import { openIdleChannel } from "@/lib/idleChannel";
import { createIdleController, type IdleController } from "@/lib/idleSession";
import { performLogout, setIdleHint } from "@/lib/sessionLogout";

// Auto logout idle untuk halaman terproteksi ((admin) layout). TIDAK dipasang di halaman auth.
// Logika ada di lib/idleSession.ts (dites tanpa browser); file ini hanya adapter DOM/jaringan.
// "Aktivitas" = interaksi user. Polling, WebSocket, dan refetch otomatis tidak pernah memanggil onActivity.

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;
const IDLE_HINT_MARGIN_MS = 10_000;
const EVENT_COALESCE_MS = 1000; // peredam event beruntun (scroll/wheel) di sisi DOM; throttle ke server tetap 60 dtk

interface SessionBody {
  idle?: { remainingSec?: unknown };
}

const remainingOf = (body: SessionBody | null): number | null =>
  body && typeof body.idle?.remainingSec === "number" ? body.idle.remainingSec : null;

// GET sesi. null = tidak login; MELEMPAR bila jaringan/server gagal (getSession() next-auth menelan error jadi null,
// sehingga tidak dipakai di sini: gangguan jaringan tidak boleh terbaca sebagai "sudah logout").
async function readRemaining(): Promise<number | null> {
  const res = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) throw new Error(`session ${res.status}`);
  return remainingOf((await res.json()) as SessionBody | null);
}

let csrfToken: string | null = null;
async function fetchCsrf(): Promise<string> {
  const res = await fetch("/api/auth/csrf", { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) throw new Error(`csrf ${res.status}`);
  const body = (await res.json()) as { csrfToken?: unknown };
  if (typeof body.csrfToken !== "string") throw new Error("csrf invalid");
  return (csrfToken = body.csrfToken);
}

// update() eksplisit (POST /api/auth/session): server memajukan deadline idle. Hanya dipanggil dari interaksi user.
async function touch(): Promise<number | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = csrfToken ?? (await fetchCsrf());
    const res = await fetch("/api/auth/session", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csrfToken: token, data: {} }),
    });
    if (res.ok) return remainingOf((await res.json()) as SessionBody | null);
    if (res.status >= 500 || attempt === 1) throw new Error(`touch ${res.status}`);
    csrfToken = null; // CSRF kedaluwarsa: ambil ulang sekali
  }
  throw new Error("touch failed");
}

export default function IdleSessionProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const controllerRef = useRef<IdleController | null>(null);
  const idle = session?.idle;
  const timeoutSec = idle?.timeoutSec;
  const warningSec = idle?.warningSec;
  // Nilai terbaru untuk effect pembuat controller (dibaca di effect, bukan saat render).
  const idleRef = useRef(idle);
  useEffect(() => {
    idleRef.current = idle;
  });

  useEffect(() => {
    const initial = idleRef.current;
    if (status !== "authenticated" || timeoutSec === undefined || warningSec === undefined || !initial) return;

    const channel = openIdleChannel((m) => controllerRef.current?.handleMessage(m));
    const controller = createIdleController(
      {
        now: () => performance.now(),
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
        readRemaining,
        touch,
        showWarning: showIdleWarning,
        logout: (reason) => void performLogout(reason === "idle" ? "idle" : "manual"),
        post: channel.post,
      },
      { timeoutSec, warningSec, initialRemainingSec: initial.remainingSec },
    );
    controllerRef.current = controller;
    // 401/4401 dari server yang datang di ujung batas idle (selisih touch/jam/tick) tetap berarti "tidak ada aktivitas".
    setIdleHint(() => controller.deadlineMs() - performance.now() <= IDLE_HINT_MARGIN_MS);
    controller.start();

    let lastHandled = Number.NEGATIVE_INFINITY;
    const onInteraction = (e: Event) => {
      const target = e.target;
      // Klik di dalam dialog peringatan ditangani tombolnya sendiri (jangan menutup dialog sebelum "Keluar" terproses).
      if (target instanceof Element && target.closest(".swal2-container")) return;
      const now = performance.now();
      if (now - lastHandled < EVENT_COALESCE_MS) return;
      lastHandled = now;
      controller.onActivity();
    };
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, onInteraction, { capture: true, passive: true });

    const onVisible = () => {
      if (document.visibilityState === "visible") controller.onVisible();
    };
    const onResume = () => controller.onVisible();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onResume);
    window.addEventListener("pageshow", onResume);

    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onInteraction, { capture: true });
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onResume);
      window.removeEventListener("pageshow", onResume);
      setIdleHint(null);
      controller.stop();
      channel.close();
      controllerRef.current = null;
    };
  }, [status, timeoutSec, warningSec]);

  // Payload sesi dari SessionProvider (mount/refetch) bukan aktivitas: hanya menyelaraskan sisa waktu.
  useEffect(() => {
    if (idle) controllerRef.current?.onSession(idle.remainingSec);
  }, [idle]);

  // Pindah halaman = aktivitas (tidak pada render pertama: itu pemuatan halaman, bukan interaksi di dalam app).
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    controllerRef.current?.onActivity();
  }, [pathname]);

  // Sesi sudah tidak ada (mis. cookie idle dibersihkan server saat mount): keluar lewat jalur yang sama.
  useEffect(() => {
    if (status === "unauthenticated") void performLogout("idle");
  }, [status]);

  return <>{children}</>;
}
