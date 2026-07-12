import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const guarded = [
  "apps/harness-api/src/registry.ts",
  "apps/harness-api/src/managed-archive.ts",
  "apps/harness-api/src/routes/superskill.ts"
];
const forbidden = [/from\s+["'][^"']*payments(?:\.js)?["']/, /@x402\//, /entitlement/i];
const failures: string[] = [];
for (const relative of guarded) {
  const file = path.join(root, relative);
  let source = "";
  try { source = readFileSync(file, "utf8"); } catch { continue; }
  for (const pattern of forbidden) if (pattern.test(source)) failures.push(`${relative} matches ${pattern}`);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("managed archive boundary: ok");
