import { z } from "zod";
import { ApiError } from "@/lib/http";

// Cursor pagination opaque: base64url(JSON). Klien memperlakukannya sebagai string buram.
export function encodeCursor(payload: Record<string, string | number | null>): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeCursor<T>(cursor: string, schema: z.ZodType<T>): T {
  try {
    const parsed = schema.safeParse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    if (parsed.success) return parsed.data;
  } catch {
    // jatuh ke error di bawah
  }
  throw new ApiError(400, "INVALID_CURSOR", "Cursor tidak valid atau kedaluwarsa; mulai dari halaman pertama");
}
