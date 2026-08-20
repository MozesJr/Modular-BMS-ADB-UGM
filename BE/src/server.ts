import "dotenv/config";
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer } from "ws";
import { setWss } from "./lib/ws";
import { registerMqttSubscriber } from "./mqtt/client";

const dev = process.env.NODE_ENV !== "production";
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url ?? "", true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });
  setWss(wss);

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url ?? "", true);
    if (pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  registerMqttSubscriber();

  server.listen(port, () => {
    console.log(`> Backend ready on :${port}  (REST: /api/*, WS: /ws)`);
  });
});