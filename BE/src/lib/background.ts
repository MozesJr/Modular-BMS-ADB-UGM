import { KeyedQueue } from "@/lib/keyed-queue";
import { log } from "@/lib/logger";

// Pekerjaan latar belakang ringan (mis. kirim email) supaya waktu respons request TIDAK bergantung
// pada hasilnya (mencegah enumerasi email lewat selisih waktu). Bounded; tidak persisten: bila proses
// restart, pekerjaan yang belum jalan hilang (untuk reset password: user tinggal meminta ulang).
type Job = { name: string; run: () => Promise<void> };

const KEY = Symbol.for("bms.background");
type G = typeof globalThis & { [KEY]?: KeyedQueue<Job> };

function queue(): KeyedQueue<Job> {
  const g = globalThis as G;
  if (!g[KEY]) {
    g[KEY] = new KeyedQueue<Job>({
      concurrency: 2,
      maxPerKey: 200,
      maxTotal: 400,
      worker: async (_key, job) => {
        await job.run();
      },
      onError: (key, err) => log.error("background.job_failed", { queue: key, err }),
    });
  }
  return g[KEY]!;
}

// `lane` = antrean berurutan (pekerjaan satu lane tidak paralel), mis. "email".
export function runInBackground(lane: string, name: string, run: () => Promise<void>) {
  const result = queue().enqueue(lane, { name, run });
  if (result === "rejected_full" || result === "rejected_closed") {
    log.warn("background.dropped", { lane, name, reason: result });
  }
}
