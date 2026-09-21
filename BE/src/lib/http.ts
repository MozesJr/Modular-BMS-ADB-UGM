import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError, type ZodType } from "zod";
import { log } from "@/lib/logger";

// Format error seragam untuk SEMUA route:
//   { "error": { "code": "DEVICE_NOT_FOUND", "message": "...", "details": ... }, "requestId": "..." }
// `code` stabil untuk mesin (klien mobile mem-branch di sini); `message` untuk manusia (bahasa Indonesia).

export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "INVALID_JSON"
  | "PAYLOAD_TOO_LARGE"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL"
  | (string & {}); // kode spesifik domain, mis. "DEVICE_NOT_FOUND"

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export const err = {
  unauthorized: (message = "Belum login atau sesi tidak berlaku") => new ApiError(401, "UNAUTHORIZED", message),
  forbidden: (message = "Anda tidak punya akses ke resource ini") => new ApiError(403, "FORBIDDEN", message),
  notFound: (message = "Data tidak ditemukan", code: ErrorCode = "NOT_FOUND") => new ApiError(404, code, message),
  badRequest: (message: string, details?: unknown) => new ApiError(400, "VALIDATION_ERROR", message, details),
  conflict: (message: string, code: ErrorCode = "CONFLICT") => new ApiError(409, code, message),
  // Lama tunggu HANYA di header Retry-After (details selalu berupa daftar isu validasi, lihat ErrorResponse di OpenAPI).
  tooMany: (retryAfterSec: number, message = "Terlalu banyak percobaan. Coba lagi nanti.") =>
    new ApiError(429, "RATE_LIMITED", message, undefined, { "Retry-After": String(Math.max(1, retryAfterSec)) }),
};

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,64}$/;

export function getRequestId(req: Request): string {
  const incoming = req.headers.get("x-request-id");
  return incoming && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
}

export function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: unknown,
  headers?: Record<string, string>,
) {
  return NextResponse.json(
    { error: { code, message, ...(details !== undefined ? { details } : {}) }, requestId },
    { status, headers: { "X-Request-Id": requestId, ...headers } },
  );
}

function zodDetails(error: ZodError) {
  return error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

export function toErrorResponse(e: unknown, requestId: string, context: { method: string; path: string }) {
  if (e instanceof ApiError) return errorResponse(e.status, e.code, e.message, requestId, e.details, e.headers);

  if (e instanceof ZodError) {
    return errorResponse(400, "VALIDATION_ERROR", e.issues[0]?.message ?? "Data tidak valid", requestId, zodDetails(e));
  }

  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") return errorResponse(409, "CONFLICT", "Data sudah ada", requestId);
    if (e.code === "P2025") return errorResponse(404, "NOT_FOUND", "Data tidak ditemukan", requestId);
    if (e.code === "P2003") return errorResponse(409, "CONFLICT", "Data terkait tidak valid", requestId);
  }

  log.error("api.unhandled_error", { requestId, method: context.method, path: context.path, err: e });
  return errorResponse(500, "INTERNAL", "Terjadi kesalahan pada server", requestId);
}

export type RouteMeta = { requestId: string };

// Bungkus route handler: menangkap semua error -> format seragam, dan menambahkan X-Request-Id.
// Contoh: export const GET = route(async (req, ctx, { requestId }) => { ... });
export function route<Ctx = unknown>(
  handler: (req: Request, ctx: Ctx, meta: RouteMeta) => Promise<Response>,
) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    const requestId = getRequestId(req);
    try {
      const res = await handler(req, ctx, { requestId });
      if (!res.headers.has("X-Request-Id")) res.headers.set("X-Request-Id", requestId);
      return res;
    } catch (e) {
      let path = "";
      try {
        path = new URL(req.url).pathname;
      } catch {}
      return toErrorResponse(e, requestId, { method: req.method, path });
    }
  };
}

const MAX_BODY_BYTES = 64 * 1024;

// Baca body JSON + validasi zod. JSON rusak -> 400 INVALID_JSON, skema gagal -> 400 VALIDATION_ERROR.
export async function parseJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Body terlalu besar");

  const text = await req.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Body terlalu besar");

  let json: unknown;
  try {
    json = text.length ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Body bukan JSON yang valid");
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new ApiError(400, "VALIDATION_ERROR", result.error.issues[0]?.message ?? "Data tidak valid", zodDetails(result.error));
  }
  return result.data;
}

export function parseQuery<T>(req: Request, schema: ZodType<T>): T {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  const result = schema.safeParse(params);
  if (!result.success) {
    throw new ApiError(400, "VALIDATION_ERROR", result.error.issues[0]?.message ?? "Parameter tidak valid", zodDetails(result.error));
  }
  return result.data;
}
