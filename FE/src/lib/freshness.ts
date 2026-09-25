// Sumber tunggal status "kesegaran" data device berdasarkan kapan paket terakhir masuk.
// Dipakai badge header, heartbeat, kartu fleet, dan gating status charging/live —
// supaya tidak ada lagi kontradiksi "Offline tapi CHARGING/Live".
//
// Kontrak MQTT publish ~10 detik sekali (dikonfirmasi). Threshold di-set longgar supaya
// tidak flapping antar paket, tapi tetap cepat menandai device yang benar-benar diam.
export const SAMPLING_INTERVAL_MS = 10_000;

// live: paket masih mengalir normal (toleransi ~2 paket hilang).
export const FRESHNESS_LIVE_MS = 25_000;
// stale: sudah lewat beberapa siklus tapi belum tentu mati — tampilkan "last known" yang redup.
export const FRESHNESS_STALE_MS = 5 * 60_000;

export type Freshness = "live" | "stale" | "offline";

export type FreshnessResult = {
  status: Freshness;
  ageMs: number;
};

// lastSeenMs = epoch ms paket terakhir; nowMs default Date.now() (di-inject saat perlu deterministik).
export function getFreshness(
  lastSeenMs: number | null | undefined,
  nowMs: number = Date.now(),
): FreshnessResult {
  if (lastSeenMs == null) return { status: "offline", ageMs: Infinity };
  const ageMs = Math.max(0, nowMs - lastSeenMs);
  if (ageMs < FRESHNESS_LIVE_MS) return { status: "live", ageMs };
  if (ageMs < FRESHNESS_STALE_MS) return { status: "stale", ageMs };
  return { status: "offline", ageMs };
}

// Format usia relatif ("3s ago", "4m ago", "2h ago") — dipakai heartbeat & label "last known".
export function formatAge(ageMs: number): string {
  if (!Number.isFinite(ageMs)) return "—";
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Label & warna semantik konsisten untuk tiap status.
export const FRESHNESS_META: Record<
  Freshness,
  { label: string; dot: string; text: string }
> = {
  live: { label: "Live", dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  stale: { label: "Stale", dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  offline: { label: "Offline", dot: "bg-gray-400", text: "text-gray-500 dark:text-gray-400" },
};
