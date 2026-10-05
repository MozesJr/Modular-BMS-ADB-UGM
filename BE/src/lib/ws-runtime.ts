import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { WebSocketServer } from "ws";
import { prisma } from "@/lib/prisma";
import { loadDeviceViewerIds } from "@/lib/device-membership";
import { wsAllowedOrigins } from "@/lib/env-check";
import { loadSessionUser, verifyBearerClaims, verifyCookieClaims } from "@/lib/session-principal";
import type { WsAuthDeps } from "@/lib/ws-auth";
import { createUpgradeHandler } from "@/lib/ws-upgrade";
import { setHub, WsHub } from "@/lib/ws-hub";

// Perakitan /ws untuk custom server: dependensi nyata (Prisma, Auth.js, access token) + penanganan handshake.
// Hanya diimpor oleh server.ts. Route handler cukup memakai ws-hub.ts (invalidateDevice/revalidateUser).

const intEnv = (name: string, fallback: number) => {
  const v = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

function realAuthDeps(): WsAuthDeps {
  return {
    allowedOrigins: new Set(wsAllowedOrigins()),
    verifyBearer: verifyBearerClaims, // null bila tidak valid; throw AccessSecretError bila salah konfigurasi (-> 503)
    verifyCookie: verifyCookieClaims,
    loadUser: loadSessionUser,
  };
}

export interface WsRuntime {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  hub: WsHub;
}

export function createWsRuntime(wss: WebSocketServer): WsRuntime {
  const hub = new WsHub(
    {
      maxConnPerUser: intEnv("WS_MAX_CONN_PER_USER", 5),
      membershipTtlMs: intEnv("WS_MEMBERSHIP_TTL_SEC", 60) * 1000,
      pingMs: intEnv("WS_PING_SEC", 30) * 1000,
      revalidateMs: intEnv("WS_REVALIDATE_SEC", 60) * 1000,
    },
    {
      loadMembers: loadDeviceViewerIds,
      loadUsers: (ids) =>
        prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, role: true, expiresAt: true, tokenVersion: true } }),
    },
  );
  setHub(hub);
  hub.start();

  const handleUpgrade = createUpgradeHandler(wss, hub, realAuthDeps());

  return { handleUpgrade, hub };
}
