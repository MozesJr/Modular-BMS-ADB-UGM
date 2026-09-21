/**
 * npm run openapi         -> menulis ../docs/openapi.json
 * npm run openapi:check   -> gagal (exit 1) bila docs/openapi.json TIDAK sinkron dengan kode, atau melanggar aturan lint
 *                            (dipakai CI; perbaiki dengan `npm run openapi` lalu commit hasilnya)
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildOpenApiDocument } from "../src/contracts/openapi";
import { lintOpenApi } from "../src/contracts/openapi-lint";

const out = path.resolve(__dirname, "../../docs/openapi.json");
const doc = buildOpenApiDocument();
const text = JSON.stringify(doc, null, 2) + "\n";

const problems = lintOpenApi(doc);
if (problems.length) {
  console.error("OpenAPI melanggar aturan kesederhanaan:\n - " + problems.join("\n - "));
  process.exit(1);
}

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(out, "utf8");
  } catch {}
  if (current !== text) {
    console.error("docs/openapi.json TIDAK sinkron dengan kontrak di kode. Jalankan: cd BE && npm run openapi, lalu commit hasilnya.");
    process.exit(1);
  }
  console.log(`docs/openapi.json sinkron (${Object.keys(doc.paths ?? {}).length} path).`);
} else {
  writeFileSync(out, text);
  console.log(`ditulis: ${out} (${Object.keys(doc.paths ?? {}).length} path)`);
}
