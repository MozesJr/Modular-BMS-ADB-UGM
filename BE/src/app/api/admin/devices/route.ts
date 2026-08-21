import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";

// GET: semua device, bisa filter ?verified=false buat liat yang pending approval
export async function GET(req: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const verifiedParam = searchParams.get("verified");

  const devices = await prisma.device.findMany({
    where: verifiedParam !== null ? { verified: verifiedParam === "true" } : undefined,
    include: {
      owner: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(devices);
}