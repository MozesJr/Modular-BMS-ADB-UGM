// Redirect pasca-login. Hanya path relatif satu "/" yang diterima (anti open redirect). Murni, dites.
const AUTH_PATHS = ["/signin", "/signup", "/forgot-password", "/reset-password"];

export function sanitizeCallbackUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null; // "//host" = protocol-relative
  if (raw.includes("\\")) return null; // "/\host" ditafsirkan browser sebagai "//host"
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null; // kontrol/CRLF/tab
  if (/^\/[^?#]*:\/\//.test(raw) || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return null; // mengandung skema
  let url: URL;
  try {
    url = new URL(raw, "http://callback.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "http://callback.invalid") return null;
  if (AUTH_PATHS.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) return null; // jangan balik ke halaman auth
  return `${url.pathname}${url.search}${url.hash}`;
}

export type SignInReason = "idle" | "expired";

export function buildSignInUrl(opts: { reason?: SignInReason; from?: string | null }): string {
  const params = new URLSearchParams();
  if (opts.reason) params.set("reason", opts.reason);
  const safe = sanitizeCallbackUrl(opts.from);
  if (safe && safe !== "/") params.set("callbackUrl", safe);
  const qs = params.toString();
  return qs ? `/signin?${qs}` : "/signin";
}
