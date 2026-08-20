import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const devices = await prisma.device.findMany({
    include: { packs: { include: { cells: true } } },
  });
  return NextResponse.json(devices);
}