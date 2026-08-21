import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { verified } = await req.json(); // true (approve) / false (reject/unverify)

  const device = await prisma.device.update({
    where: { id },
    data: { verified: !!verified },
  });

  return NextResponse.json(device);
}