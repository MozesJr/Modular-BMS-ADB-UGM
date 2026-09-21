import { NextResponse } from "next/server";
import { parseJson, route } from "@/lib/http";
import { getClientIp } from "@/lib/client-ip";
import { enforceRateLimit, POLICIES } from "@/lib/rate-limit";
import { rotateSession } from "@/lib/token-sessions";
import { RefreshRequestSchema } from "@/contracts/schemas";

// POST /api/v1/auth/refresh — tukar refresh token dengan pasangan baru. Refresh token LAMA langsung tidak berlaku;
// memakainya lagi = reuse -> seluruh sesi (family) dicabut.
export const POST = route(async (req) => {
  enforceRateLimit([{ policy: POLICIES.refreshIp, id: getClientIp(req) }]);
  const { refreshToken } = await parseJson(req, RefreshRequestSchema);
  const tokens = await rotateSession(refreshToken);
  return NextResponse.json(tokens, { headers: { "Cache-Control": "no-store" } });
});
