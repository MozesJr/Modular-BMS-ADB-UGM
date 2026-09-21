import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "./openapi";
import { lintOpenApi } from "./openapi-lint";

describe("openapi-lint", () => {
  it("menolak konstruksi yang menyulitkan generator", () => {
    expect(lintOpenApi({ a: { oneOf: [] } })).toHaveLength(1);
    expect(lintOpenApi({ a: { anyOf: [] } })).toHaveLength(1);
    expect(lintOpenApi({ a: { allOf: [{ $ref: "#/x" }, { nullable: true }] } })).toHaveLength(1);
    expect(lintOpenApi({ a: { type: ["string", "null"] } })).toHaveLength(1);
    expect(lintOpenApi({ a: { const: "x" } })).toHaveLength(1);
    expect(lintOpenApi({ a: { nullable: true, $ref: "#/x" } })).toHaveLength(1);
  });
  it("menerima skema sederhana", () => {
    expect(lintOpenApi({ a: { type: "string", nullable: true }, b: { $ref: "#/components/schemas/X" } })).toEqual([]);
  });
});

describe("dokumen OpenAPI", () => {
  const doc = buildOpenApiDocument();
  it("berversi 3.0.3 dan lolos lint", () => {
    expect(doc.openapi).toBe("3.0.3");
    expect(lintOpenApi(doc)).toEqual([]);
  });
  it("setiap operasi punya operationId unik, tag, dan response error seragam", () => {
    const ids = new Set<string>();
    for (const [p, item] of Object.entries(doc.paths ?? {})) {
      for (const [method, op] of Object.entries(item as Record<string, any>)) {
        expect(op.operationId, `${method} ${p}`).toBeTruthy();
        expect(ids.has(op.operationId), `operationId ganda ${op.operationId}`).toBe(false);
        ids.add(op.operationId);
        expect(op.tags?.length, `${method} ${p}`).toBeGreaterThan(0);
        expect(op.responses["500"]?.content?.["application/json"]?.schema?.$ref).toBe("#/components/schemas/ErrorResponse");
      }
    }
  });
});
