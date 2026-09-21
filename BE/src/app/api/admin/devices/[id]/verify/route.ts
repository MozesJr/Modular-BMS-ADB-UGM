import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { parseJson, route } from "@/lib/http";

const verifyBody = z.object({ verified: z.boolean({ error: "verified harus true atau false" }) });

export const PATCH = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  await requireAdmin();
  const { id } = await params;
  const { verified } = await parseJson(req, verifyBody); // true (approve) / false (reject/unverify)

  // P2025 (id tidak ada) dipetakan route() ke 404
  const device = await prisma.device.update({ where: { id }, data: { verified } });
  return NextResponse.json(device);
});
