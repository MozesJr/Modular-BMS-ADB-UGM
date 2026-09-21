import "./openapi-setup";
import { z } from "zod";
import { emailSchema, serialNumberSchema } from "./common";

// ============================================================================================
// SKEMA KONTRAK API v1 — satu sumber kebenaran untuk validasi request, bentuk response, docs/openapi.json.
//
// Aturan desain (dijaga oleh openapi-lint, gagal di CI) agar klien hasil generate (mis. Dart) sederhana:
//   - TANPA oneOf/anyOf/allOf, TANPA `type: [..., "null"]` (gaya 3.1), TANPA nullable pada objek/$ref.
//     `nullable` hanya untuk tipe primitif (string/number/integer/boolean).
//   - Satuan ada di NAMA field: voltageV (V), currentA (A), powerW (W), temperatureC (°C), cellDeltaMv (mV).
//   - Semua waktu = string ISO-8601 UTC (`2026-09-21T08:15:00.000Z`).
//   - Tidak ada SoC/SoH (belum ada di payload perangkat).
// ============================================================================================

const iso = () => z.iso.datetime({ offset: false }).openapi({ example: "2026-09-21T08:15:00.000Z" });

// ---------- error ----------
export const ErrorIssueSchema = z
  .object({ path: z.string(), message: z.string() })
  .openapi("ErrorIssue");

export const ErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "DEVICE_NOT_FOUND", description: "Kode stabil untuk mesin; jangan mem-branch pada `message`." }),
      message: z.string().openapi({ description: "Pesan untuk manusia (bahasa Indonesia)." }),
      details: z.array(ErrorIssueSchema).optional().openapi({ description: "Hanya untuk VALIDATION_ERROR: daftar isu per field." }),
    }),
    requestId: z.string().openapi({ description: "Sama dengan header X-Request-Id; sertakan saat melaporkan masalah." }),
  })
  .openapi("ErrorResponse");

// ---------- auth ----------
export const RoleSchema = z.enum(["USER", "ADMIN"]).openapi("UserRole");

export const MeSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    name: z.string().nullable(),
    role: RoleSchema,
    expiresAt: iso().nullable().openapi({ description: "Akun berakhir pada waktu ini; null = tidak pernah." }),
  })
  .openapi("Me");

export const LoginRequestSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1, "Password wajib diisi").max(200),
    deviceName: z.string().trim().max(100).optional().openapi({ description: "Nama perangkat (mis. 'Pixel 8'), ditampilkan di daftar sesi." }),
  })
  .openapi("LoginRequest");

export const RefreshRequestSchema = z
  .object({ refreshToken: z.string().min(20, "refreshToken tidak valid").max(200) })
  .openapi("RefreshRequest");

export const LogoutRequestSchema = z
  .object({ refreshToken: z.string().min(20, "refreshToken tidak valid").max(200) })
  .openapi("LogoutRequest");

export const TokenResponseSchema = z
  .object({
    accessToken: z.string().openapi({ description: "JWT, kirim sebagai `Authorization: Bearer …`. Simpan HANYA di memori." }),
    refreshToken: z.string().openapi({ description: "Opaque, sekali pakai (rotasi). Simpan di Keychain/Keystore." }),
    tokenType: z.enum(["Bearer"]),
    expiresIn: z.number().int().openapi({ description: "Umur access token dalam detik.", example: 900 }),
    refreshExpiresIn: z.number().int().openapi({ description: "Umur refresh token dalam detik.", example: 2592000 }),
    user: MeSchema,
  })
  .openapi("TokenResponse");

// ---------- device ----------
export const DeviceRoleSchema = z.enum(["owner", "editor", "viewer"]).openapi("DeviceRole");
export const CollaboratorRoleSchema = z.enum(["viewer", "editor"]).openapi("CollaboratorRole");

export const PackSummarySchema = z
  .object({
    index: z.number().int(),
    voltageV: z.number().nullable().openapi({ description: "Jumlah tegangan seluruh cell pack (V)." }),
    currentA: z.number().nullable().openapi({ description: "Ampere; NEGATIF = charging, positif = discharging." }),
    powerW: z.number().nullable(),
    temperatureC: z.number().nullable().openapi({ description: "null = sensor error / tidak ada pembacaan." }),
    cellDeltaMv: z.number().nullable().openapi({ description: "Selisih cell tertinggi − terendah (mV)." }),
    cellCount: z.number().int(),
  })
  .openapi("PackSummary");

export const DeviceStatsSchema = z
  .object({
    packs: z.array(PackSummarySchema),
    maxTemperatureC: z.number().nullable(),
    maxCellDeltaMv: z.number().nullable(),
    totalPowerW: z.number().nullable(),
    minCellVoltageV: z.number().nullable(),
    maxCellVoltageV: z.number().nullable(),
  })
  .openapi("DeviceStats");

export const DeviceOwnerSchema = z.object({ id: z.string(), name: z.string().nullable() }).openapi("DeviceOwner");

const deviceBase = {
  id: z.string(),
  serialNumber: z.string(),
  name: z.string().nullable(),
  verified: z.boolean().openapi({ description: "Sudah disetujui admin." }),
  role: DeviceRoleSchema.openapi({ description: "Peran user yang sedang login pada device ini." }),
  owner: DeviceOwnerSchema,
  online: z.boolean().openapi({ description: "Ada data dalam batas waktu online (default 180 dtk)." }),
  lastSeenAt: iso().nullable().openapi({ description: "Waktu server menerima data terakhir." }),
  packCount: z.number().int(),
};

export const DeviceListItemSchema = z
  .object({
    ...deviceBase,
    summary: DeviceStatsSchema.optional().openapi({ description: "Ada bila view=summary." }),
  })
  .openapi("DeviceListItem");

export const DeviceListResponseSchema = z
  .object({
    items: z.array(DeviceListItemSchema),
    nextCursor: z.string().nullable().openapi({ description: "Kirim sebagai ?cursor= untuk halaman berikutnya; null = habis." }),
  })
  .openapi("DeviceListResponse");

export const CellSchema = z.object({ index: z.number().int(), voltageV: z.number() }).openapi("Cell");

export const PackDetailSchema = z
  .object({
    index: z.number().int(),
    temperatureC: z.number().nullable(),
    balancerConnected: z.boolean(),
    currentA: z.number().nullable(),
    powerW: z.number().nullable(),
    voltageV: z.number().nullable(),
    cellDeltaMv: z.number().nullable(),
    recordedAt: iso().nullable().openapi({ description: "Waktu efektif data (jam device bila wajar, selain itu waktu server)." }),
    receivedAt: iso().nullable().openapi({ description: "Waktu server menerima data." }),
    cells: z.array(CellSchema),
  })
  .openapi("PackDetail");

export const CollaboratorSchema = z
  .object({
    userId: z.string(),
    name: z.string().nullable(),
    email: z.string().nullable().openapi({ description: "Hanya terisi bila peminta adalah OWNER device; selain itu null." }),
    role: CollaboratorRoleSchema,
    addedAt: iso(),
  })
  .openapi("Collaborator");

export const DeviceDetailSchema = z
  .object({
    ...deviceBase,
    createdAt: iso(),
    summary: DeviceStatsSchema,
    packs: z.array(PackDetailSchema),
    collaborators: z.array(CollaboratorSchema),
  })
  .openapi("DeviceDetail");

export const DevicesQuerySchema = z.object({
  view: z.enum(["basic", "summary"]).default("summary").openapi({ description: "`summary` menyertakan ringkasan telemetri per device." }),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(300).optional(),
});

export const ClaimDeviceRequestSchema = z
  .object({ serialNumber: serialNumberSchema, name: z.string().trim().max(100).optional() })
  .openapi("ClaimDeviceRequest");

export const UpdateDeviceRequestSchema = z
  .object({ name: z.string().trim().min(1, "Nama tidak boleh kosong").max(100) })
  .openapi("UpdateDeviceRequest");

export const DeleteDeviceQuerySchema = z.object({
  mode: z.enum(["unclaim", "delete"]).default("unclaim").openapi({
    description: "`unclaim`: lepas kepemilikan (data tetap, device kembali tanpa owner, collaborator dilepas). `delete`: hapus device + seluruh riwayat (wajib confirmSerial).",
  }),
  confirmSerial: z.string().optional().openapi({ description: "Wajib = serialNumber bila mode=delete." }),
});

// ---------- dashboard ----------
export const DashboardSummarySchema = z
  .object({
    deviceCount: z.number().int(),
    onlineCount: z.number().int(),
    offlineCount: z.number().int(),
    pendingVerificationCount: z.number().int(),
    totalPowerW: z.number().nullable().openapi({ description: "Jumlah daya pack pada device ONLINE; negatif = net charging." }),
    maxTemperatureC: z.number().nullable(),
    maxCellDeltaMv: z.number().nullable(),
    generatedAt: iso(),
  })
  .openapi("DashboardSummary");

// ---------- history ----------
export const HistoryBucketSchema = z.enum(["raw", "1m", "5m", "1h"]).openapi("HistoryBucket");
export const HistoryMetricSchema = z.enum(["temperature", "current", "power", "voltage"]).openapi("HistoryMetric");

export const HistoryPointSchema = z
  .object({
    t: iso().openapi({ description: "Awal bucket (UTC). Untuk raw: waktu sampel." }),
    v: z.number().openapi({ description: "Nilai (raw) atau rata-rata bucket." }),
    min: z.number().nullable().openapi({ description: "Minimum bucket; null untuk raw." }),
    max: z.number().nullable().openapi({ description: "Maksimum bucket; null untuk raw." }),
  })
  .openapi("HistoryPoint");

export const HistorySeriesSchema = z
  .object({
    scope: z.enum(["pack", "cell"]),
    packIndex: z.number().int(),
    cellIndex: z.number().int().nullable().openapi({ description: "null untuk seri level pack." }),
    metric: HistoryMetricSchema,
    unit: z.enum(["C", "A", "W", "V"]),
    points: z.array(HistoryPointSchema),
  })
  .openapi("HistorySeries");

export const HistoryResponseSchema = z
  .object({
    deviceId: z.string(),
    from: iso(),
    to: iso(),
    bucket: HistoryBucketSchema,
    series: z.array(HistorySeriesSchema),
    nextCursor: z.string().nullable().openapi({ description: "Hanya untuk bucket=raw; null = habis." }),
  })
  .openapi("HistoryResponse");

export const HistoryQuerySchema = z.object({
  from: z.string().optional().openapi({ description: "ISO-8601 UTC; default = to − 24 jam." }),
  to: z.string().optional().openapi({ description: "ISO-8601 UTC; default = sekarang." }),
  bucket: HistoryBucketSchema.default("5m"),
  metrics: z.string().optional().openapi({ description: "CSV dari temperature,current,power,voltage. Default: temperature,current,power. `voltage` = per cell (banyak seri)." }),
  packIndex: z.coerce.number().int().min(0).optional().openapi({ description: "Batasi ke satu pack." }),
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional().openapi({ description: "Hanya untuk raw: maks sampel per halaman (default 1000)." }),
});

// ---------- collaborators ----------
export const AddCollaboratorRequestSchema = z
  .object({ email: emailSchema, role: CollaboratorRoleSchema.default("viewer") })
  .openapi("AddCollaboratorRequest");

export const UpdateCollaboratorRequestSchema = z
  .object({ role: CollaboratorRoleSchema })
  .openapi("UpdateCollaboratorRequest");

export const CollaboratorListSchema = z.object({ items: z.array(CollaboratorSchema) }).openapi("CollaboratorList");

// ---------- health ----------
export const HealthResponseSchema = z
  .object({
    status: z.enum(["ok", "degraded", "down", "shutting_down"]),
    uptimeSec: z.number().int(),
    db: z.object({ ok: z.boolean(), latencyMs: z.number().int().nullable() }),
    mqtt: z.object({
      connected: z.boolean(),
      lastMessageAt: iso().nullable(),
      lastMessageAgeSec: z.number().int().nullable(),
    }),
    ingest: z.object({ queueDepth: z.number().int() }),
    counters: z.record(z.string(), z.number()),
  })
  .openapi("HealthResponse");
