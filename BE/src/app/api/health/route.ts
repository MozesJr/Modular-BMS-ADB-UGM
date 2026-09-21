import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runtime } from "@/lib/runtime-state";

export const dynamic = "force-dynamic";

const DB_TIMEOUT_MS = 2000;

async function pingDb(): Promise<{ ok: boolean; latencyMs: number | null }> {
  const t0 = Date.now();
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("db timeout")), DB_TIMEOUT_MS)),
    ]);
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch {
    return { ok: false, latencyMs: null };
  }
}

// GET /api/health — tanpa autentikasi (dipakai HEALTHCHECK Docker / monitoring), tanpa data sensitif.
//   200 ok        : DB hidup dan MQTT terhubung
//   200 degraded  : DB hidup tapi MQTT terputus (backend tetap melayani REST)
//   503 down      : DB tidak menjawab
//   503 shutting_down : sedang graceful shutdown (biar load balancer berhenti mengirim trafik)
export async function GET() {
  const rt = runtime();
  const now = Date.now();
  const db = await pingDb();

  const status = rt.shuttingDown ? "shutting_down" : !db.ok ? "down" : rt.mqtt.connected ? "ok" : "degraded";

  const body = {
    status,
    uptimeSec: Math.round((now - rt.startedAt) / 1000),
    db,
    mqtt: {
      connected: rt.mqtt.connected,
      lastMessageAt: rt.mqtt.lastMessageAt ? new Date(rt.mqtt.lastMessageAt).toISOString() : null,
      lastMessageAgeSec: rt.mqtt.lastMessageAt ? Math.round((now - rt.mqtt.lastMessageAt) / 1000) : null,
    },
    ingest: { queueDepth: rt.ingestQueueDepth },
    counters: rt.counters,
  };

  return NextResponse.json(body, {
    status: status === "ok" || status === "degraded" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
