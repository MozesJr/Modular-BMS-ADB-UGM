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

// Mengembalikan daftar masalah konfigurasi (kosong = OK).
export function checkRequiredEnv(env: Env = process.env): string[] {
  return [checkAccessSecret(env)].filter((p): p is string => p !== null);
}
