// Antrean bounded dengan dua jaminan:
//  - item dengan key yang sama diproses BERURUTAN dan tidak pernah paralel (mis. satu device)
//  - paling banyak `concurrency` key diproses bersamaan (melindungi pool koneksi DB)
// Batas memori: `maxPerKey` (buang yang TERLAMA, karena state terbaru lebih berharga) dan
// `maxTotal` (buang item baru).
export type EnqueueResult = "queued" | "queued_dropped_oldest" | "rejected_full" | "rejected_closed";

export interface KeyedQueueOptions<T> {
  concurrency: number;
  maxPerKey: number;
  maxTotal: number;
  worker: (key: string, item: T) => Promise<void>;
  onError?: (key: string, err: unknown) => void;
}

export class KeyedQueue<T> {
  private pending = new Map<string, T[]>();
  private ready: string[] = []; // key yang punya antrean dan sedang tidak berjalan
  private active = new Set<string>();
  private running = 0;
  private total = 0;
  private accepting = true;
  private idleWaiters: Array<() => void> = [];

  constructor(private readonly opts: KeyedQueueOptions<T>) {}

  get size() {
    return this.total + this.running;
  }

  enqueue(key: string, item: T): EnqueueResult {
    if (!this.accepting) return "rejected_closed";
    if (this.total >= this.opts.maxTotal) return "rejected_full";

    let q = this.pending.get(key);
    if (!q) {
      q = [];
      this.pending.set(key, q);
    }

    let result: EnqueueResult = "queued";
    if (q.length >= this.opts.maxPerKey) {
      q.shift();
      this.total--;
      result = "queued_dropped_oldest";
    }
    q.push(item);
    this.total++;

    if (!this.active.has(key) && !this.ready.includes(key)) this.ready.push(key);
    this.pump();
    return result;
  }

  private pump() {
    while (this.running < this.opts.concurrency && this.ready.length > 0) {
      const key = this.ready.shift()!;
      const q = this.pending.get(key);
      const item = q?.shift();
      if (q === undefined || item === undefined) {
        this.pending.delete(key);
        continue;
      }
      this.total--;
      this.active.add(key);
      this.running++;

      this.opts
        .worker(key, item)
        .catch((err) => this.opts.onError?.(key, err))
        .finally(() => {
          this.active.delete(key);
          this.running--;
          const rest = this.pending.get(key);
          if (rest && rest.length > 0) this.ready.push(key);
          else this.pending.delete(key);
          this.pump();
          this.notifyIfIdle();
        });
    }
  }

  private notifyIfIdle() {
    if (this.running === 0 && this.total === 0) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      waiters.forEach((w) => w());
    }
  }

  // Berhenti menerima item baru dan tunggu yang ada selesai (maksimal timeoutMs).
  // Mengembalikan jumlah item yang belum selesai (0 = tuntas).
  async drain(timeoutMs: number): Promise<number> {
    this.accepting = false;
    if (this.running === 0 && this.total === 0) return 0;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this.idleWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    return this.size;
  }
}
