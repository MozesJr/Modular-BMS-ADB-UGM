import { z } from "zod";
import { DEVICE_ID_REGEX } from "@/mqtt/schema";

// Primitif skema yang dipakai bersama route (dan nanti OpenAPI v1). Pesan dalam bahasa Indonesia
// karena langsung ditampilkan FE/mobile.

export const emailSchema = z
  .string({ error: "Email wajib diisi" })
  .trim()
  .min(3, "Email tidak valid")
  .max(254, "Email terlalu panjang")
  .email("Email tidak valid");

// bcrypt hanya memakai 72 byte pertama; tolak lebih dari itu supaya user tidak mengira seluruhnya dipakai.
export const newPasswordSchema = z
  .string({ error: "Password wajib diisi" })
  .min(8, "Password minimal 8 karakter")
  .max(128, "Password terlalu panjang")
  .refine((v) => Buffer.byteLength(v, "utf8") <= 72, "Password maksimal 72 byte");

export const nameSchema = z.string().trim().max(100, "Nama maksimal 100 karakter");

export const serialNumberSchema = z
  .string({ error: "Device ID/lisensi wajib diisi" })
  .trim()
  .regex(DEVICE_ID_REGEX, "Device ID hanya boleh huruf, angka, titik, minus, underscore (maks 64 karakter)");

export const deviceNameSchema = z.string().trim().max(100, "Nama device maksimal 100 karakter");

// Tanggal ISO ("2026-12-31" atau datetime) atau null/"" = tidak pernah expired.
export const expiresAtSchema = z
  .union([z.string(), z.null()])
  .transform((v, ctx) => {
    if (v === null || v === "") return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Tanggal expired tidak valid" });
      return z.NEVER;
    }
    return d;
  });

export const roleSchema = z.enum(["USER", "ADMIN"], { error: "Role harus USER atau ADMIN" });
export const collaboratorRoleSchema = z.enum(["viewer", "editor"], { error: "Role harus viewer atau editor" });
