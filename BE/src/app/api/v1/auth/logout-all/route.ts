import { route } from "@/lib/http";
import { requireAuth } from "@/lib/authz";
import { endAllSessions } from "@/lib/token-sessions";

// POST /api/v1/auth/logout-all — logout dari SEMUA perangkat (mobile dan web): tokenVersion++ mematikan semua
// access token dan sesi cookie seketika; semua refresh token dicabut.
export const POST = route(async () => {
  const session = await requireAuth();
  await endAllSessions(session.user.id);
  return new Response(null, { status: 204 });
});
