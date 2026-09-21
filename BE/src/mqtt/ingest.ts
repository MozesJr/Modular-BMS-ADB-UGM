import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { broadcast } from "@/lib/ws";
import { log } from "@/lib/logger";
import { incr, runtime } from "@/lib/runtime-state";
import { KeyedQueue } from "@/lib/keyed-queue";
import type { BmsDevicePayload } from "@/mqtt/schema";

// Pipeline ingestion: antrean bounded per device -> satu transaksi batch per pesan.
// Query per pesan KONSTAN (±5) berapa pun jumlah pack/cell (sebelumnya 1 + packs×(1+cells)).

export interface IngestJob {
  deviceId: string; // = Device.serialNumber
  payload: BmsDevicePayload;
  recordedAt: Date; // waktu efektif (lihat mqtt/timestamp.ts)
  receivedAt: Date; // waktu server menerima pesan
}

const intEnv = (name: string, fallback: number) => {
  const v = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

// ---------- persistence ----------

// Diformat sebagai literal timestamp UTC; kolom Prisma bertipe TIMESTAMP(3) tanpa zona waktu.
const ts = (d: Date) => Prisma.sql`${d.toISOString()}::timestamp`;
const NOW_UTC = Prisma.sql`(now() AT TIME ZONE 'UTC')`;

async function ensureDevice(serialNumber: string) {
  const existing = await prisma.device.findUnique({
    where: { serialNumber },
    select: { id: true, serialNumber: true },
  });
  if (existing) return existing;
  try {
    return await prisma.device.create({
      data: { serialNumber },
      select: { id: true, serialNumber: true },
    });
  } catch (err) {
    // Balapan pembuatan device (mis. proses lain): baris sudah ada, ambil saja.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return prisma.device.findUniqueOrThrow({
        where: { serialNumber },
        select: { id: true, serialNumber: true },
      });
    }
    throw err;
  }
}

export interface PersistResult {
  device: { id: string; serialNumber: string };
  packsUpdated: number;
  packsStale: number; // state terbaru tidak ditimpa karena pesan lebih lama
  historyDuplicates: number;
}

export async function persistSnapshot(job: IngestJob): Promise<PersistResult> {
  const { payload, recordedAt, receivedAt } = job;
  const device = await ensureDevice(job.deviceId);

  return prisma.$transaction(
    async (tx) => {
      // 1) State terbaru per pack. Hanya menimpa bila pesan ini tidak lebih lama dari yang tersimpan.
      const packValues = payload.packs.map(
        (p) =>
          Prisma.sql`(${randomUUID()}, ${p.index}, ${device.id}, ${p.temperature}, ${p.balancerConnected}, ${
            p.current ?? null
          }, ${p.power ?? null}, ${ts(recordedAt)}, ${ts(receivedAt)}, ${NOW_UTC})`,
      );
      const updatedPacks = await tx.$queryRaw<{ id: string; index: number }[]>(Prisma.sql`
        INSERT INTO "Pack" ("id","index","deviceId","temperature","balancerConnected","current","power","recordedAt","receivedAt","updatedAt")
        VALUES ${Prisma.join(packValues)}
        ON CONFLICT ("deviceId","index") DO UPDATE SET
          "temperature" = EXCLUDED."temperature",
          "balancerConnected" = EXCLUDED."balancerConnected",
          "current" = EXCLUDED."current",
          "power" = EXCLUDED."power",
          "recordedAt" = EXCLUDED."recordedAt",
          "receivedAt" = EXCLUDED."receivedAt",
          "updatedAt" = EXCLUDED."updatedAt"
        WHERE "Pack"."recordedAt" IS NULL OR "Pack"."recordedAt" <= EXCLUDED."recordedAt"
        RETURNING "id","index"`);

      // 2) State terbaru per cell — hanya untuk pack yang benar-benar diperbarui di langkah 1.
      const packIdByIndex = new Map(updatedPacks.map((r) => [r.index, r.id]));
      const cellValues: Prisma.Sql[] = [];
      for (const pack of payload.packs) {
        const packId = packIdByIndex.get(pack.index);
        if (!packId) continue;
        for (const cell of pack.cells) {
          cellValues.push(Prisma.sql`(${randomUUID()}, ${cell.index}, ${packId}, ${cell.voltage}, ${NOW_UTC})`);
        }
      }
      if (cellValues.length > 0) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "Cell" ("id","index","packId","voltage","updatedAt")
          VALUES ${Prisma.join(cellValues)}
          ON CONFLICT ("packId","index") DO UPDATE SET
            "voltage" = EXCLUDED."voltage",
            "updatedAt" = EXCLUDED."updatedAt"`);
      }

      // 3) History: selalu disimpan; duplikat (unique) dilewati -> idempoten terhadap redelivery.
      const packHistory: Prisma.PackHistoryCreateManyInput[] = [];
      const cellHistory: Prisma.CellHistoryCreateManyInput[] = [];
      for (const pack of payload.packs) {
        packHistory.push({
          deviceId: device.id,
          packIndex: pack.index,
          temperature: pack.temperature,
          balancerConnected: pack.balancerConnected,
          current: pack.current ?? null,
          power: pack.power ?? null,
          recordedAt,
          receivedAt,
        });
        for (const cell of pack.cells) {
          cellHistory.push({
            deviceId: device.id,
            packIndex: pack.index,
            cellIndex: cell.index,
            voltage: cell.voltage,
            recordedAt,
          });
        }
      }
      const insertedPacks = await tx.packHistory.createMany({ data: packHistory, skipDuplicates: true });
      const insertedCells = await tx.cellHistory.createMany({ data: cellHistory, skipDuplicates: true });

      return {
        device,
        packsUpdated: updatedPacks.length,
        packsStale: payload.packs.length - updatedPacks.length,
        historyDuplicates:
          packHistory.length - insertedPacks.count + (cellHistory.length - insertedCells.count),
      };
    },
    { maxWait: 5_000, timeout: 15_000 },
  );
}

function isRetryable(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return err.code === "P2002" || err.code === "P2034"; // unique race / write conflict / deadlock
  }
  return err instanceof Error && /deadlock detected/i.test(err.message);
}

export async function persistWithRetry(job: IngestJob, attempts = 3): Promise<PersistResult> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await persistSnapshot(job);
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || i === attempts) break;
      incr("ingest.retried");
      await new Promise((r) => setTimeout(r, 50 * i));
    }
  }
  throw lastErr;
}

// ---------- antrean ----------

let queue: KeyedQueue<IngestJob> | null = null;

function getQueue(): KeyedQueue<IngestJob> {
  if (queue) return queue;
  queue = new KeyedQueue<IngestJob>({
    concurrency: intEnv("INGEST_CONCURRENCY", 4),
    maxPerKey: intEnv("INGEST_MAX_PER_DEVICE", 20),
    maxTotal: intEnv("INGEST_MAX_TOTAL", 2000),
    worker: async (_key, job) => {
      const result = await persistWithRetry(job);
      incr("mqtt.stored");
      if (result.packsStale > 0) incr("ingest.stale_latest_skipped", result.packsStale);
      if (result.historyDuplicates > 0) incr("ingest.history_duplicates", result.historyDuplicates);

      // Broadcast HANYA dari objek hasil parse yang sudah tersimpan.
      broadcast("bms:update", {
        id: result.device.id,
        serialNumber: result.device.serialNumber,
        timestamp: job.recordedAt.getTime(),
        receivedAt: job.receivedAt.getTime(),
        packs: job.payload.packs,
      });
    },
    onError: (key, err) => {
      incr("mqtt.failed");
      log.error("ingest.persist_failed", { deviceId: key, err });
    },
    onSettled: () => {
      runtime().ingestQueueDepth = queue?.size ?? 0;
    },
  });
  return queue;
}

export function enqueueIngest(job: IngestJob) {
  const q = getQueue();
  const result = q.enqueue(job.deviceId, job);
  runtime().ingestQueueDepth = q.size;
  if (result === "queued_dropped_oldest") incr("mqtt.dropped");
  if (result === "rejected_full" || result === "rejected_closed") {
    incr("mqtt.dropped");
    log.warn("ingest.dropped", { deviceId: job.deviceId, reason: result });
  }
  return result;
}

// Dipanggil saat shutdown: berhenti menerima, tunggu yang sedang berjalan. Mengembalikan sisa.
export async function drainIngest(timeoutMs: number): Promise<number> {
  return getQueue().drain(timeoutMs);
}
