import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

// Graf impor custom server (src/server.ts) TIDAK BOLEH memuat modul Next berbasis request. next/server (dan
// next/headers, auth() dari next-auth) di luar konteks Next menyimpan AsyncLocalStorage palsu; request pertama ke
// route handler lalu melempar "Invariant: AsyncLocalStorage accessed in runtime where it is not available" dan proses
// crash-loop (insiden produksi feat/ws-auth). Tes runtime-nya: scripts/smoke-ws-compiled.ts (di CI).
const SRC = path.resolve(__dirname, "..");
const ENTRY = path.join(SRC, "server.ts");

// "next" (entry utama untuk next({dev})) satu-satunya impor Next yang sah di custom server.
const FORBIDDEN_PACKAGES = [/^next\/.+/, /^next-auth$/, /^next-auth\/(?!jwt$).+/, /^@auth\/core$/, /^@auth\/core\/(?!jwt$).+/];
const FORBIDDEN_LOCAL = ["lib/auth.ts", "lib/authz.ts", "lib/http.ts", "lib/device-access.ts", "lib/etag.ts", "lib/rate-limit.ts"];

function resolveLocal(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;
  for (const c of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), base]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

// Semua specifier runtime (import/export from/import()/require); `import type` tidak ikut karena terhapus saat kompilasi.
function runtimeSpecifiers(file: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const c = n.importClause;
      const typeOnly = c?.isTypeOnly || (c?.namedBindings && ts.isNamedImports(c.namedBindings) && !c.name && c.namedBindings.elements.length > 0 && c.namedBindings.elements.every((e) => e.isTypeOnly));
      if (!typeOnly) out.push(n.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) && !n.isTypeOnly) {
      out.push(n.moduleSpecifier.text);
    } else if (ts.isCallExpression(n) && n.arguments.length === 1 && ts.isStringLiteralLike(n.arguments[0])) {
      const callee = n.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require")) out.push(n.arguments[0].text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function walk() {
  const parent = new Map<string, string | null>([[ENTRY, null]]);
  const queue = [ENTRY];
  const violations: string[] = [];
  const chain = (f: string) => {
    const parts: string[] = [];
    for (let cur: string | null | undefined = f; cur; cur = parent.get(cur)) parts.unshift(path.relative(SRC, cur));
    return parts.join(" -> ");
  };
  while (queue.length > 0) {
    const file = queue.shift()!;
    const rel = path.relative(SRC, file);
    if (rel.startsWith(`app${path.sep}`) || FORBIDDEN_LOCAL.includes(rel)) violations.push(`modul terlarang dimuat custom server: ${chain(file)}`);
    for (const spec of runtimeSpecifiers(file)) {
      const local = resolveLocal(file, spec);
      if (local) {
        if (!parent.has(local)) {
          parent.set(local, file);
          queue.push(local);
        }
      } else if (FORBIDDEN_PACKAGES.some((re) => re.test(spec))) {
        violations.push(`impor "${spec}": ${chain(file)}`);
      }
    }
  }
  return { modules: [...parent.keys()].map((f) => path.relative(SRC, f)), violations };
}

describe("graf impor custom server (server.ts)", () => {
  const graph = walk();

  it("tidak memuat next/*, next-auth (entry utama), lib/auth, lib/authz, lib/http, atau route handler", () => {
    expect(graph.violations).toEqual([]);
  });

  it("graf mencakup modul WS (penjaga tidak diam-diam kosong)", () => {
    expect(graph.modules).toEqual(expect.arrayContaining(["lib/ws-runtime.ts", "lib/ws-hub.ts", "lib/session-principal.ts", "lib/device-membership.ts", "mqtt/ingest.ts"]));
  });
});
