import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { parseQuery, route } from "@/lib/http";

const listQuery = z.object({
  verified: z.enum(["true", "false"]).optional(),
});

// GET: semua device, bisa filter ?verified=false buat liat yang pending approval
export const GET = route(async (req) => {
  await requireAdmin();
  const { verified } = parseQuery(req, listQuery);

  const devices = await prisma.device.findMany({
    where: verified !== undefined ? { verified: verified === "true" } : undefined,
    include: {
      owner: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(devices);
});
