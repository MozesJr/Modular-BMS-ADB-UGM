"use client";
import { useWsControls, useWsStatus } from "@/context/WsContext";

// Indikator koneksi WebSocket global (kecil, di header).
export default function WsIndicator() {
  const status = useWsStatus();
  const { retry } = useWsControls();

  if (status === "rejected") {
    // Server menolak koneksi realtime (bukan putus jaringan): berhenti mencoba sampai pengguna memilih coba lagi.
    return (
      <button
        type="button"
        onClick={retry}
        title="Koneksi realtime ditolak server. Klik untuk mencoba lagi."
        aria-label="Realtime terputus. Klik untuk mencoba lagi"
        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 dark:border-red-900 dark:text-red-400"
      >
        <span className="h-2 w-2 rounded-full bg-red-500" />
        <span className="hidden sm:inline">Realtime terputus · Coba lagi</span>
      </button>
    );
  }

  const meta =
    status === "connected"
      ? { dot: "bg-emerald-500", label: "Live", pulse: false }
      : status === "connecting"
        ? { dot: "bg-amber-500", label: "Menyambung", pulse: true }
        : { dot: "bg-red-500", label: "Terputus", pulse: true };
  return (
    <span
      title={`WebSocket: ${status}`}
      aria-label={`Status koneksi realtime: ${meta.label}`}
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-500 dark:border-gray-800 dark:text-gray-400"
    >
      <span className={`h-2 w-2 rounded-full ${meta.dot} ${meta.pulse ? "animate-pulse" : ""}`} />
      <span className="hidden sm:inline">{meta.label}</span>
    </span>
  );
}
