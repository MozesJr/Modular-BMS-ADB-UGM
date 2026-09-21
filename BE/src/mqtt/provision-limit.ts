// Membatasi jumlah Device BARU (tanpa owner) yang boleh dibuat otomatis dari topik MQTT per jam.
// Tanpa ini, satu kredensial MQTT bocor bisa membanjiri tabel Device dengan serial ngawur.
// In-memory sliding window (satu instance); restart mengosongkan hitungan (batas dapat terlampaui sekali setelah restart).
export const DEFAULT_PROVISION_MAX_PER_HOUR = 20;
const WINDOW_MS = 60 * 60 * 1000;

export class ProvisionLimiter {
  private stamps: number[] = [];

  // maxPerHour = 0 -> auto-provision dimatikan sepenuhnya.
  constructor(public maxPerHour: number) {}

  tryAcquire(now: number = Date.now()): boolean {
    this.stamps = this.stamps.filter((t) => now - t < WINDOW_MS);
    if (this.stamps.length >= this.maxPerHour) return false;
    this.stamps.push(now);
    return true;
  }

  get used(): number {
    return this.stamps.length;
  }
}

function fromEnv(): number {
  const raw = process.env.PROVISION_MAX_PER_HOUR;
  if (raw === undefined || raw.trim() === "") return DEFAULT_PROVISION_MAX_PER_HOUR;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_PROVISION_MAX_PER_HOUR;
}

let limiter: ProvisionLimiter | null = null;

export function getProvisionLimiter(): ProvisionLimiter {
  return (limiter ??= new ProvisionLimiter(fromEnv()));
}

// Untuk tes.
export function setProvisionLimiter(l: ProvisionLimiter | null) {
  limiter = l;
}
