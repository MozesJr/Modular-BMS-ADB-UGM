import { isIP } from "node:net";

// IP klien untuk rate limiting. Urutan:
//   1. header proxy tepercaya (default X-Real-IP; Nginx MENIMPA header ini dengan $remote_addr sehingga
//      tidak bisa dipalsukan klien). Ganti lewat RATE_LIMIT_IP_HEADER (mis. cf-connecting-ip di belakang Cloudflare).
//   2. alamat socket yang dicatat server.ts di header internal x-bms-peer.
// PENTING: BE tidak boleh terjangkau langsung dari internet; kalau terjangkau, header 1 bisa dipalsukan.
export const PEER_HEADER = "x-bms-peer";

export function getClientIp(req: Request): string {
  const name = (process.env.RATE_LIMIT_IP_HEADER ?? "x-real-ip").toLowerCase();
  for (const header of [name, PEER_HEADER]) {
    const raw = req.headers.get(header)?.split(",")[0]?.trim();
    if (raw && isIP(raw.replace(/^::ffff:/, ""))) return raw.replace(/^::ffff:/, "");
  }
  return "unknown";
}
