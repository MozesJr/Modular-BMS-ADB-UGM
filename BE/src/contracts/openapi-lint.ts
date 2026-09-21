// Menjaga dokumen OpenAPI tetap "sederhana" untuk generator klien (Dart dll.). Mengembalikan daftar pelanggaran.
export function lintOpenApi(doc: unknown): string[] {
  const problems: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      node.forEach((n, i) => walk(n, `${path}[${i}]`));
      return;
    }
    if (node === null || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    for (const k of ["oneOf", "anyOf", "allOf", "not"]) {
      if (k in obj) problems.push(`${path}: '${k}' tidak diizinkan`);
    }
    if (Array.isArray(obj.type)) problems.push(`${path}: 'type' berupa array (gaya OpenAPI 3.1) tidak diizinkan`);
    if ("const" in obj) problems.push(`${path}: 'const' tidak diizinkan (gunakan enum)`);
    if (obj.nullable === true && "$ref" in obj) problems.push(`${path}: nullable pada $ref tidak diizinkan`);
    for (const [k, v] of Object.entries(obj)) walk(v, `${path}/${k}`);
  };
  walk(doc, "#");
  return problems;
}
