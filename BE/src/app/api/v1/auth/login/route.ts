import { NextResponse } from "next/server";
import { ApiError, parseJson, route } from "@/lib/http";
import { getClientIp } from "@/lib/client-ip";
import { enforceRateLimit, POLICIES } from "@/lib/rate-limit";
import { verifyCredentials } from "@/lib/credentials";
import { startSession } from "@/lib/token-sessions";
import { LoginRequestSchema } from "@/contracts/schemas";

// POST /api/v1/auth/login — email+password -> access token (JWT ±15 mnt) + refresh token (opaque, dirotasi).
export const POST = route(async (req) => {
  const body = await parseJson(req, LoginRequestSchema);

  enforceRateLimit([
    { policy: POLICIES.loginIp, id: getClientIp(req) },
    { policy: POLICIES.loginAccount, id: body.email.toLowerCase() },
  ]);

  const result = await verifyCredentials(body.email, body.password);
  if (!result.ok) {
    if (result.reason === "expired") throw new ApiError(403, "ACCOUNT_EXPIRED", "Akun sudah kedaluwarsa. Hubungi admin.");
    throw new ApiError(401, "INVALID_CREDENTIALS", "Email atau password salah");
  }

  const tokens = await startSession(result.user, body.deviceName);
  return NextResponse.json(tokens, { headers: { "Cache-Control": "no-store" } });
});
