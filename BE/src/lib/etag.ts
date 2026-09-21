import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

// ETag untuk snapshot/summary: klien mengirim If-None-Match -> 304 tanpa body bila tidak berubah (hemat data/baterai).
// `basis` = objek yang di-hash (buang field yang berubah tiap request, mis. generatedAt).
export function etagOf(basis: unknown): string {
  return `W/"${createHash("sha1").update(JSON.stringify(basis)).digest("base64url").slice(0, 27)}"`;
}

const strip = (t: string) => t.trim().replace(/^W\//, "");

export function matchesIfNoneMatch(header: string | null, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;
  return header.split(",").some((t) => strip(t) === strip(etag));
}

export function jsonWithEtag(req: Request, body: unknown, basis: unknown = body): Response {
  const etag = etagOf(basis);
  const headers = {
    ETag: etag,
    // no-cache = boleh disimpan tapi WAJIB revalidasi (If-None-Match) sebelum dipakai; private = data per user
    "Cache-Control": "private, no-cache",
    Vary: "Authorization, Cookie",
  };
  if (matchesIfNoneMatch(req.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  return NextResponse.json(body, { headers });
}
