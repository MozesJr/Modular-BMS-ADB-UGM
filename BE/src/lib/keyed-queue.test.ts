import { describe, expect, it } from "vitest";
import { KeyedQueue } from "./keyed-queue";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeQueue(over: Partial<ConstructorParameters<typeof KeyedQueue<number>>[0]> = {}) {
  const log: string[] = [];
  let concurrent = 0;
  let maxConcurrent = 0;
  const perKeyActive = new Map<string, number>();
  let perKeyViolation = false;
  const q = new KeyedQueue<number>({
    concurrency: 2,
    maxPerKey: 3,
    maxTotal: 100,
    worker: async (key, n) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      perKeyActive.set(key, (perKeyActive.get(key) ?? 0) + 1);
      if (perKeyActive.get(key)! > 1) perKeyViolation = true;
      await sleep(5);
      log.push(`${key}:${n}`);
      perKeyActive.set(key, perKeyActive.get(key)! - 1);
      concurrent--;
    },
    ...over,
  });
  return { q, log, stats: () => ({ maxConcurrent, perKeyViolation }) };
}

describe("KeyedQueue", () => {
  it("memproses berurutan per key dan tidak pernah paralel untuk key yang sama", async () => {
    const { q, log, stats } = makeQueue({ maxPerKey: 10 });
    for (let i = 1; i <= 5; i++) q.enqueue("a", i);
    expect(await q.drain(1000)).toBe(0);
    expect(log).toEqual(["a:1", "a:2", "a:3", "a:4", "a:5"]);
    expect(stats().perKeyViolation).toBe(false);
  });

  it("membatasi konkurensi antar key", async () => {
    const { q, log, stats } = makeQueue({ concurrency: 2 });
    for (const k of ["a", "b", "c", "d", "e"]) q.enqueue(k, 1);
    await q.drain(1000);
    expect(log).toHaveLength(5);
    expect(stats().maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("membuang item TERLAMA per key saat penuh (state terbaru dipertahankan)", async () => {
    const { q, log } = makeQueue({ concurrency: 1, maxPerKey: 2 });
    q.enqueue("blocker", 0); // memakai satu-satunya slot
    const results = [1, 2, 3, 4].map((n) => q.enqueue("a", n));
    expect(results).toEqual(["queued", "queued", "queued_dropped_oldest", "queued_dropped_oldest"]);
    await q.drain(1000);
    expect(log.filter((l) => l.startsWith("a:"))).toEqual(["a:3", "a:4"]);
  });

  it("menolak item baru saat total penuh", async () => {
    const { q } = makeQueue({ concurrency: 1, maxTotal: 2, maxPerKey: 10 });
    q.enqueue("blocker", 0);
    expect(q.enqueue("a", 1)).toBe("queued");
    expect(q.enqueue("b", 1)).toBe("queued");
    expect(q.enqueue("c", 1)).toBe("rejected_full");
    await q.drain(1000);
  });

  it("error worker tidak menghentikan antrean", async () => {
    const errors: string[] = [];
    const done: number[] = [];
    const q = new KeyedQueue<number>({
      concurrency: 1,
      maxPerKey: 10,
      maxTotal: 10,
      worker: async (_k, n) => {
        if (n === 1) throw new Error("boom");
        done.push(n);
      },
      onError: (_k, e) => errors.push((e as Error).message),
    });
    q.enqueue("a", 1);
    q.enqueue("a", 2);
    await q.drain(1000);
    expect(errors).toEqual(["boom"]);
    expect(done).toEqual([2]);
  });

  it("drain menutup antrean dan mengembalikan sisa saat timeout", async () => {
    const q = new KeyedQueue<number>({
      concurrency: 1,
      maxPerKey: 5,
      maxTotal: 5,
      worker: async () => {
        await sleep(200);
      },
    });
    q.enqueue("a", 1);
    q.enqueue("a", 2);
    const left = await q.drain(20);
    expect(left).toBeGreaterThan(0);
    expect(q.enqueue("a", 3)).toBe("rejected_closed");
  });
});
