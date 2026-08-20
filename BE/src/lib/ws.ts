import type { WebSocketServer } from "ws";

let wssInstance: WebSocketServer | null = null;

export function setWss(wss: WebSocketServer) {
  wssInstance = wss;
}

export function broadcast(event: string, payload: unknown) {
  if (!wssInstance) return;
  const message = JSON.stringify({ event, payload, ts: Date.now() });
  wssInstance.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(message);
    }
  });
}