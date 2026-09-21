import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { registry } from "./endpoints";

export const API_VERSION = "1.0.0";

export function buildOpenApiDocument() {
  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: "3.0.3",
    info: {
      title: "Modular Universal BMS API",
      version: API_VERSION,
      description: [
        "API backend untuk aplikasi mobile dan web. Panduan lengkap: docs/API-GUIDE.md.",
        "",
        "Konvensi: base path `/api/v1`; waktu ISO-8601 UTC; satuan ada di nama field (voltageV, currentA, powerW, temperatureC, cellDeltaMv);",
        "error seragam `{ error: { code, message, details? }, requestId }`; tidak ada SoC/SoH (belum ada di payload perangkat).",
      ].join("\n"),
    },
    servers: [{ url: "https://YOUR-HOST", description: "Ganti dengan origin publik backend (HTTPS wajib untuk build rilis mobile)" }],
    tags: [
      { name: "Auth", description: "Token akses + refresh dengan rotasi" },
      { name: "Akun", description: "Profil user" },
      { name: "Device", description: "Daftar dan detail device, klaim, ubah nama, lepas/hapus" },
      { name: "Riwayat", description: "Time-series (raw atau agregat)" },
      { name: "Collaborator", description: "Berbagi akses device (viewer/editor)" },
      { name: "Dashboard", description: "Ringkasan lintas device" },
      { name: "Operasional", description: "Health check" },
    ],
  });
}
