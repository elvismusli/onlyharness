import { readFileSync } from "node:fs";
import path from "node:path";
import * as resources from "../apps/harness-api/src/resources.js";
import { isReleaseSemver, migrateLegacyResourceRelease, reconcileResourceReleases } from "../apps/harness-api/src/resource-releases.js";

type ManifestEntry = { resourceId?: string; version?: string; ownerSubject?: string; artifactDigest?: string };
const args = process.argv.slice(2);
const manifestArg = args.indexOf("--manifest");
const execute = args.includes("--execute");
if (manifestArg < 0 || !args[manifestArg + 1]) {
  console.error("Usage: npm run migrate:resource-archives -- --manifest <reviewed.json> [--execute]");
  process.exit(2);
}

const reconciliation = await reconcileResourceReleases();
if (reconciliation.store === "unavailable") {
  console.error(JSON.stringify({ ok: false, code: "RELEASE_STORE_UNAVAILABLE" }));
  process.exit(1);
}

const manifestPath = path.resolve(args[manifestArg + 1]);
const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as { releases?: ManifestEntry[] };
if (!Array.isArray(parsed.releases) || parsed.releases.length === 0) throw new Error("Migration manifest needs non-empty releases[]");
const catalog = resources.readResourceCatalog();
const seen = new Set<string>();
const validated = parsed.releases.map((entry) => {
  const resource = catalog.resources.find((item) => item.id === entry.resourceId);
  if (!resource || !entry.resourceId?.startsWith("onlyharness:packages/")) throw new Error(`Unknown hosted resource: ${entry.resourceId ?? "missing"}`);
  if (!isReleaseSemver(entry.version)) throw new Error(`Invalid version for ${entry.resourceId}`);
  if (!entry.ownerSubject || !/^user:[a-f0-9]{64}$/.test(entry.ownerSubject)) throw new Error(`Invalid canonical ownerSubject for ${entry.resourceId}`);
  if (!entry.artifactDigest || !/^[a-f0-9]{64}$/.test(entry.artifactDigest)) throw new Error(`Invalid artifactDigest for ${entry.resourceId}`);
  const tuple = `${entry.resourceId}@${entry.version}`;
  if (seen.has(tuple)) throw new Error(`Duplicate migration tuple: ${tuple}`);
  seen.add(tuple);
  return { resource: { ...resource, creatorName: "OnlyHarness publisher" }, version: entry.version, ownerSubject: entry.ownerSubject, expectedDigest: entry.artifactDigest };
});

if (!execute) {
  console.log(JSON.stringify({ ok: true, dryRun: true, releases: validated.map((item) => ({ resourceId: item.resource.id, version: item.version, artifactDigest: item.expectedDigest })), next: "Review the exact inventory and rerun with --execute." }, null, 2));
  process.exit(0);
}

const results = [];
for (const entry of validated) {
  const result = await migrateLegacyResourceRelease(entry);
  if ("code" in result) {
    console.error(JSON.stringify({ ok: false, code: result.code, resourceId: entry.resource.id, version: entry.version }));
    process.exit(1);
  }
  results.push({ resourceId: entry.resource.id, version: entry.version, ...result });
}
console.log(JSON.stringify({ ok: true, migrated: results.map((item) => ({ resourceId: item.resourceId, version: item.version, artifactDigest: item.release.artifactDigest, replay: item.replay })) }, null, 2));
