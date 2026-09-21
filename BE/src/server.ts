import "dotenv/config";
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer } from "ws";
import { setWss, closeAllClients } from "./lib/ws";
import { registerMqttSubscriber, stopMqttSubscriber } from "./mqtt/client";
import { drainIngest } from "./mqtt/ingest";
import { prisma } from "./lib/prisma";
import { log } from "./lib/logger";
import { runtime } from "./lib/runtime-state";
import { PEER_HEADER } from "./lib/client-ip";

const dev = process.env.NODE_ENV !== "production";
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
const SHUTDOWN_TIMEOUT_MS = 25_000; // di bawah stop_grace_period compose (30s)
const INGEST_DRAIN_MS = 10_000;

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    // Header internal: alamat socket asli (dipakai rate limiter bila tidak ada header proxy). Selalu
    // ditimpa di sini supaya klien tidak bisa memalsukannya.
    req.headers[PEER_HEADER] = req.socket.remoteAddress ?? "";
    const parsedUrl = parse(req.url ?? "", true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });
  setWss(wss);

  wss.on("error", (err) => console.error("[ws] server error", err));
  wss.on("connection", (ws, req) => {
    console.log(`[ws] client connected (${req.socket.remoteAddress})`);
    ws.on("error", (err) => console.error("[ws] connection error", err));
    ws.on("close", (code, reason) => {
      console.log(`[ws] client disconnected code=${code} reason=${reason.toString() || "-"}`);
    });
  });

  server.on("upgrade", (req, socket, head) => {
    // Attach before any async/parsing work so handshake-time errors get logged
    // instead of crashing the process silently (an unhandled 'error' on a
    // socket throws) or surfacing as an unexplained 1006 on the client.
    socket.on("error", (err) => console.error("[ws] upgrade socket error", err));

    if (runtime().shuttingDown) {
      socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    let pathname: string;
    try {
      pathname = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`).pathname;
    } catch (err) {
      console.error("[ws] failed to parse upgrade URL", req.url, err);
      socket.destroy();
      return;
    }

    if (pathname !== "/ws") {
      console.warn(`[ws] upgrade rejected, unknown path: ${pathname}`);
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  registerMqttSubscriber();

  server.listen(port, () => {
    log.info("server.ready", { port, rest: "/api/*", ws: "/ws" });
  });

  // ---- Graceful shutdown ----------------------------------------------------------------
  // Urutan: (1) /api/health -> 503, (2) berhenti menerima MQTT, (3) tuntaskan antrean ingestion,
  // (4) tutup WS + HTTP, (5) putus DB. Ada batas waktu keras supaya tidak menggantung.
  let stopping = false;
  async function shutdown(signal: string) {
    if (stopping) return;
    stopping = true;
    runtime().shuttingDown = true;
    log.info("shutdown.start", { signal });

    const hardStop = setTimeout(() => {
      log.error("shutdown.timeout_forcing_exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    hardStop.unref();

    try {
      await stopMqttSubscriber();
      const left = await drainIngest(INGEST_DRAIN_MS);
      if (left > 0) log.warn("shutdown.ingest_not_drained", { pending: left });

      closeAllClients();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections?.();
        setTimeout(() => {
          server.closeAllConnections?.();
          resolve();
        }, 3000).unref();
      });
      await prisma.$disconnect();
      log.info("shutdown.done");
      process.exit(0);
    } catch (err) {
      log.error("shutdown.failed", { err });
      process.exit(1);
    }
  }
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
});
