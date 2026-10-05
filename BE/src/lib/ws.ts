import { getHub, WS_CLOSE_UNAUTHENTICATED } from "@/lib/ws-hub";

export { WS_CLOSE_UNAUTHENTICATED };

// Fasad tipis untuk pemanggil lama (mqtt/ingest.ts). Signature dan bentuk pesan tidak berubah:
// { event, payload, ts }. Pengiriman difilter per user oleh WsHub (lihat ws-hub.ts) dan TIDAK PERNAH melempar.
export function broadcast(event: string, payload: unknown): void {
  const hub = getHub();
  if (!hub) {
    console.warn("[ws] broadcast called before WS runtime initialised — event dropped", event);
    return;
  }
  hub.broadcast(event, payload);
}

// Dipakai saat shutdown: tutup semua koneksi dengan kode 1001 (going away) supaya klien reconnect ke instance baru.
export function closeAllClients(reason = "server shutting down") {
  getHub()?.closeAll(1001, reason);
}
