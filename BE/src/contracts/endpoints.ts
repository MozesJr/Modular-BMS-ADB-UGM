import "./openapi-setup";
import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import type { ZodType } from "zod";
import {
  ErrorResponseSchema,
  HealthResponseSchema,
  LoginRequestSchema,
  LogoutRequestSchema,
  RefreshRequestSchema,
  TokenResponseSchema,
} from "./schemas";

// Registri endpoint untuk docs/openapi.json. SETIAP endpoint v1 yang diimplementasikan didaftarkan di sini dengan
// skema yang SAMA dengan yang dipakai route (satu sumber kebenaran). Menambah endpoint = tambah `endpoint({...})`
// lalu `npm run openapi` (CI gagal bila docs/openapi.json tidak sinkron).

export const registry = new OpenAPIRegistry();

registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description: "Access token dari POST /api/v1/auth/login atau /refresh.",
});

const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: "VALIDATION_ERROR / INVALID_JSON: request tidak valid",
  401: "UNAUTHORIZED: token hilang/kedaluwarsa/dicabut (atau kredensial salah)",
  403: "FORBIDDEN: tidak punya hak pada resource ini",
  404: "NOT_FOUND: resource tidak ada",
  409: "CONFLICT: bentrok dengan keadaan saat ini",
  413: "PAYLOAD_TOO_LARGE",
  426: "UPGRADE_REQUIRED: versi aplikasi terlalu lama",
  429: "RATE_LIMITED: tunggu sesuai header Retry-After",
  500: "INTERNAL: kesalahan server (sertakan requestId saat melapor)",
};

type Method = "get" | "post" | "patch" | "delete" | "put";

export interface EndpointDef {
  method: Method;
  path: string; // format OpenAPI: /api/v1/devices/{id}
  tag: string;
  summary: string;
  description?: string;
  operationId: string;
  auth?: boolean; // default true (Bearer)
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
  success: { status: number; description: string; schema?: ZodType };
  errors?: number[]; // kode error yang mungkin; 500 selalu ditambahkan
  headers?: Record<string, { description: string }>;
}

export function endpoint(def: EndpointDef) {
  const errors = Array.from(new Set([...(def.errors ?? []), 500])).sort();
  const responses: Record<string, unknown> = {
    [def.success.status]: {
      description: def.success.description,
      ...(def.headers ? { headers: Object.fromEntries(Object.entries(def.headers).map(([k, v]) => [k, { description: v.description, schema: { type: "string" } }])) } : {}),
      ...(def.success.schema ? { content: { "application/json": { schema: def.success.schema } } } : {}),
    },
  };
  for (const status of errors) {
    responses[String(status)] = {
      description: ERROR_DESCRIPTIONS[status] ?? "Error",
      content: { "application/json": { schema: ErrorResponseSchema } },
    };
  }

  registry.registerPath({
    method: def.method,
    path: def.path,
    tags: [def.tag],
    summary: def.summary,
    description: def.description,
    operationId: def.operationId,
    security: def.auth === false ? [] : [{ bearerAuth: [] }],
    request: {
      ...(def.params ? { params: def.params as never } : {}),
      ...(def.query ? { query: def.query as never } : {}),
      ...(def.body ? { body: { required: true, content: { "application/json": { schema: def.body } } } } : {}),
    },
    responses: responses as never,
  });
}

// ---------------------------------------------------------------------------------------------
// Operasional
// ---------------------------------------------------------------------------------------------
endpoint({
  method: "get",
  path: "/api/health",
  tag: "Operasional",
  summary: "Health check",
  description:
    "Tanpa autentikasi. 200 untuk `ok`/`degraded`, 503 untuk `down`/`shutting_down`. Tidak berisi data sensitif. Bukan bagian dari versi API v1.",
  operationId: "getHealth",
  auth: false,
  success: { status: 200, description: "DB hidup (MQTT mungkin terputus = degraded)", schema: HealthResponseSchema },
  errors: [],
});

// ---------------------------------------------------------------------------------------------
// Auth (token)
// ---------------------------------------------------------------------------------------------
endpoint({
  method: "post",
  path: "/api/v1/auth/login",
  tag: "Auth",
  summary: "Login",
  description:
    "Email + password -> access token (JWT, ±15 menit) dan refresh token (opaque, 30 hari, sekali pakai). " +
    "Batas: 10 percobaan/15 menit per akun dan 30 per IP (429 + Retry-After). Kode khusus: INVALID_CREDENTIALS (401), ACCOUNT_EXPIRED (403).",
  operationId: "login",
  auth: false,
  body: LoginRequestSchema,
  success: { status: 200, description: "Token diterbitkan", schema: TokenResponseSchema },
  errors: [400, 401, 403, 429],
});

endpoint({
  method: "post",
  path: "/api/v1/auth/refresh",
  tag: "Auth",
  summary: "Perbarui token (rotasi)",
  description:
    "Menukar refresh token dengan pasangan baru; refresh token lama LANGSUNG tidak berlaku. Memakai refresh token yang sudah pernah dipakai " +
    "(REFRESH_REUSED) mencabut SELURUH sesi perangkat itu. Kode 401: INVALID_REFRESH_TOKEN, REFRESH_EXPIRED, REFRESH_REVOKED, REFRESH_REUSED, SESSION_REVOKED — " +
    "untuk semuanya: hapus token lokal dan minta login ulang. Lakukan refresh dengan SATU permintaan sekaligus (single-flight).",
  operationId: "refreshToken",
  auth: false,
  body: RefreshRequestSchema,
  success: { status: 200, description: "Pasangan token baru", schema: TokenResponseSchema },
  errors: [400, 401, 403, 429],
});

endpoint({
  method: "post",
  path: "/api/v1/auth/logout",
  tag: "Auth",
  summary: "Logout perangkat ini",
  description:
    "Mencabut sesi (seluruh rantai refresh token) perangkat ini. Selalu 204 (idempoten). Access token yang sudah terbit tetap berlaku sampai " +
    "kedaluwarsa (≤ 15 menit): buang dari memori di klien.",
  operationId: "logout",
  auth: false,
  body: LogoutRequestSchema,
  success: { status: 204, description: "Sesi dicabut" },
  errors: [400, 429],
});

endpoint({
  method: "post",
  path: "/api/v1/auth/logout-all",
  tag: "Auth",
  summary: "Logout dari semua perangkat",
  description:
    "Mencabut semua refresh token user dan menaikkan tokenVersion: SEMUA access token (mobile) dan sesi cookie (web) berhenti berlaku seketika.",
  operationId: "logoutAll",
  success: { status: 204, description: "Semua sesi dicabut" },
  errors: [401],
});
