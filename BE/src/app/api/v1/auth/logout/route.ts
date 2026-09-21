import { parseJson, route } from "@/lib/http";
import { getClientIp } from "@/lib/client-ip";
import { enforceRateLimit, POLICIES } from "@/lib/rate-limit";
import { endSession } from "@/lib/token-sessions";
import { LogoutRequestSchema } from "@/contracts/schemas";

// POST /api/v1/auth/logout — cabut sesi perangkat ini (seluruh family refresh token). Selalu 204 (idempoten, tanpa oracle).
export const POST = route(async (req) => {
  enforceRateLimit([{ policy: POLICIES.refreshIp, id: getClientIp(req) }]);
  const { refreshToken } = await parseJson(req, LogoutRequestSchema);
  await endSession(refreshToken);
  return new Response(null, { status: 204 });
});
