import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

// Harus dijalankan sebelum skema memanggil .openapi(). Idempotent; di-import paling awal oleh schemas.ts.
extendZodWithOpenApi(z);
