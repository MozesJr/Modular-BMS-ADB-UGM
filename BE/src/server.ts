import "dotenv/config";
import { createServer } from "http";
import next from "next";
import { WebSocketServer } from "ws";
import { setWss } from "./lib/ws";
import { registerMqttSubscriber } from "./mqtt/client";

const dev = process.env.NODE_ENV !== "production";
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  // Biarkan Next mem-parse URL sendiri (WHATWG di internal) — hindari DEP0169 url.parse().
  const server = createServer((req, res) => {
    handle(req, res);
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
    console.log(`> Backend ready on :${port}  (REST: /api/*, WS: /ws)`);
  });
});