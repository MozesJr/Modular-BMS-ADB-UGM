import type { NextRequest } from "next/server";
import { handlers } from "@/lib/auth";
import { getClientIp } from "@/lib/client-ip";
import { errorResponse, getRequestId, ApiError } from "@/lib/http";
import { enforceRateLimit, POLICIES } from "@/lib/rate-limit";

export const { GET } = handlers;

// Rate limit hanya untuk percobaan login (callback/credentials); endpoint Auth.js lain (session, csrf, ...) bebas.
async function limitLogin(req: Request): Promise<Response | null> {
  const requestId = getRequestId(req);
  let email = "";
  try {
    const form = await req.clone().formData();
    email = String(form.get("email") ?? "").trim().toLowerCase();
  } catch {
    // body bukan form: cukup batasi per IP
  }

  try {
    enforceRateLimit([
      { policy: POLICIES.loginIp, id: getClientIp(req) },
      ...(email ? [{ policy: POLICIES.loginAccount, id: email }] : []),
    ]);
    return null;
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    const headers = { "Retry-After": e.headers?.["Retry-After"] ?? "60", "X-Request-Id": requestId };
    // signIn(..., { redirect: false }) dari next-auth/react membaca `url` dan mengambil ?error=&code= dari sana.
    if (req.headers.get("x-auth-return-redirect")) {
      const origin = new URL(req.url).origin;
      return Response.json({ url: `${origin}/signin?error=RateLimited&code=rate_limited` }, { status: 429, headers });
    }
    return errorResponse(429, e.code, e.message, requestId, e.details, headers);
  }
}

export async function POST(req: NextRequest) {
  if (new URL(req.url).pathname.endsWith("/callback/credentials")) {
    const limited = await limitLogin(req);
    if (limited) return limited;
  }
  return handlers.POST(req);
}
