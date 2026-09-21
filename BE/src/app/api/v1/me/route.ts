import { route } from "@/lib/http";
import { requireAuth } from "@/lib/authz";
import { jsonWithEtag } from "@/lib/etag";
import type { z } from "zod";
import type { MeSchema } from "@/contracts/schemas";

// GET /api/v1/me — profil user yang sedang login (dari DB, bukan dari isi token).
export const GET = route(async (req) => {
  const { user } = await requireAuth();
  const me: z.infer<typeof MeSchema> = {
    id: user.id,
    email: user.email ?? "",
    name: user.name ?? null,
    role: user.role,
    expiresAt: user.expiresAt,
  };
  return jsonWithEtag(req, me);
});
