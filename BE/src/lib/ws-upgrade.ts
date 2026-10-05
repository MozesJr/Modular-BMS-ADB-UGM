import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { WebSocketServer } from "ws";
import { log } from "@/lib/logger";
import { authenticateUpgrade, type WsAuthDeps } from "@/lib/ws-auth";
import type { WsHub } from "@/lib/ws-hub";

// Penanganan handshake /ws: autentikasi + Origin + batas koneksi, semuanya SEBELUM handshake selesai. Murni (dependensi
// disuntikkan) supaya dites dengan server nyata; perakitan dependensi produksi ada di ws-runtime.ts.

const STATUS_TEXT = {
  401: "Unauthorized",
  403: "Forbidden",
  429: "Too Many Requests",
  503: "Service Unavailable",
} as const;

// Tolak SEBELUM handshake selesai (tidak pernah accept-lalu-close).
function reject(socket: Duplex, status: keyof typeof STATUS_TEXT) {
  const retry = status === 429 || status === 503 ? "Retry-After: 30\r\n" : "";
  socket.write(`HTTP/1.1 ${status} ${STATUS_TEXT[status]}\r\n${retry}Connection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function createUpgradeHandler(wss: WebSocketServer, hub: WsHub, deps: WsAuthDeps) {
  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    void (async () => {
      const result = await authenticateUpgrade(req.headers, deps);
      if (socket.destroyed) return; // klien menyerah selama verifikasi
      if (!result.ok) {
        log.info("ws.upgrade_rejected", { status: result.status, reason: result.reason });
        reject(socket, result.status);
        return;
      }
      if (!hub.reserve(result.identity.userId)) {
        log.info("ws.upgrade_rejected", { status: 429, reason: "too_many_connections", userId: result.identity.userId });
        reject(socket, 429);
        return;
      }
      try {
        // handleUpgrade (tanpa verifyClient/deflate) memanggil callback secara sinkron; bila socket sudah mati ia
        // membatalkan tanpa callback, jadi reservasi dilepas di sini.
        let attached = false;
        wss.handleUpgrade(req, socket, head, (ws) => {
          attached = true;
          hub.attach(ws, result.identity);
        });
        if (!attached) hub.release(result.identity.userId);
      } catch (err) {
        hub.release(result.identity.userId);
        log.error("ws.upgrade_failed", { err });
        socket.destroy();
      }
    })().catch((err) => {
      log.error("ws.upgrade_failed", { err });
      if (!socket.destroyed) reject(socket, 503);
    });
  }

  return handleUpgrade;
}
