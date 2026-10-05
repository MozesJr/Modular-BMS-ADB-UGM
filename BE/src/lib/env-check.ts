// Variabel lingkungan wajib untuk fitur token mobile. Dipanggil saat startup (server.ts) supaya salah konfigurasi
// gagal CEPAT dan jelas, bukan 500 acak saat request pertama. Tidak pernah mencetak nilai secret.
export const MIN_SECRET_LENGTH = 32;

type Env = Record<string, string | undefined>;

export function checkAccessSecret(env: Env = process.env): string | null {
  const secret = env.JWT_ACCESS_SECRET;
  if (!secret) return "JWT_ACCESS_SECRET belum diset (wajib; generate: openssl rand -base64 48)";
  if (secret.length < MIN_SECRET_LENGTH) return `JWT_ACCESS_SECRET terlalu pendek (minimal ${MIN_SECRET_LENGTH} karakter)`;
  if (env.NEXTAUTH_SECRET && secret === env.NEXTAUTH_SECRET) {
    return "JWT_ACCESS_SECRET tidak boleh sama dengan NEXTAUTH_SECRET (harus terpisah)";
  }
  return null;
}

// --- WebSocket (/ws) ---
// Origin FE lokal yang otomatis diizinkan HANYA di luar produksi (dev lokal tidak rusak tanpa konfigurasi).
export const WS_DEV_DEFAULT_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
];

// "https://a.com, http://localhost:3000/" -> origin ternormalisasi (tanpa path/slash akhir, huruf kecil).
// Entri yang bukan origin http(s) murni masuk `invalid` (tidak pernah diam-diam dibuang).
export function parseAllowedOrigins(raw: string | undefined): { origins: string[]; invalid: string[] } {
  const origins: string[] = [];
  const invalid: string[] = [];
  for (const item of (raw ?? "").split(",")) {
    const value = item.trim();
    if (!value) continue;
    try {
      const u = new URL(value);
      const isOrigin = (u.protocol === "http:" || u.protocol === "https:") && (u.pathname === "/" || u.pathname === "") && !u.search && !u.hash;
      if (isOrigin) origins.push(u.origin.toLowerCase());
      else invalid.push(value);
    } catch {
      invalid.push(value);
    }
  }
  return { origins, invalid };
}

// Daftar origin yang berlaku untuk /ws. Produksi: hanya dari env. Lainnya: env bila diisi, selain itu default dev.
export function wsAllowedOrigins(env: Env = process.env): string[] {
  const { origins } = parseAllowedOrigins(env.WS_ALLOWED_ORIGINS);
  if (origins.length > 0) return origins;
  return env.NODE_ENV === "production" ? [] : WS_DEV_DEFAULT_ORIGINS;
}

const WS_INT_ENVS = ["WS_MAX_CONN_PER_USER", "WS_PING_SEC", "WS_REVALIDATE_SEC", "WS_MEMBERSHIP_TTL_SEC"] as const;

export function checkWsEnv(env: Env = process.env): string[] {
  const problems: string[] = [];
  const { origins, invalid } = parseAllowedOrigins(env.WS_ALLOWED_ORIGINS);
  if (invalid.length > 0) problems.push("WS_ALLOWED_ORIGINS berisi entri yang bukan origin (contoh benar: https://contoh.com)");
  if (env.NODE_ENV === "production" && origins.length === 0) {
    problems.push("WS_ALLOWED_ORIGINS belum diset (wajib di produksi; contoh: https://contoh.com, dipisah koma)");
  }
  for (const name of WS_INT_ENVS) {
    const v = env[name];
    if (v !== undefined && v !== "" && !/^[1-9]\d*$/.test(v)) problems.push(`${name} harus bilangan bulat positif`);
  }
  return problems;
}

// Mengembalikan daftar masalah konfigurasi (kosong = OK).
export function checkRequiredEnv(env: Env = process.env): string[] {
  return [checkAccessSecret(env), ...checkWsEnv(env)].filter((p): p is string => p !== null);
}
