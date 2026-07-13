import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import * as resources from "../apps/harness-api/src/resources.js";
import { reconcileResourceReleases, resourceReleaseInventory, verifyResourceReleaseInventory } from "../apps/harness-api/src/resource-releases.js";

const reconciliation = await reconcileResourceReleases();
if (reconciliation.store === "unavailable") {
  console.error(JSON.stringify({ ok: false, code: "RELEASE_STORE_UNAVAILABLE" }));
  process.exit(1);
}

const legacyRoot = path.resolve(process.env.RESOURCE_ARCHIVE_DIR ?? "data/resources/archives");
const catalog = resources.readResourceCatalog();
const byId = new Map(catalog.resources.map((resource) => [resource.id, resource]));
const imports = resourceReleaseInventory();
const parity = verifyResourceReleaseInventory();
const legacy = existsSync(legacyRoot)
  ? readdirSync(legacyRoot).filter((file) => file.endsWith(".tar.gz")).sort().map((storageKey) => {
    const resourceId = decodeArchiveKey(storageKey);
    const bytes = readFileSync(path.join(legacyRoot, storageKey));
    const resource = resourceId ? byId.get(resourceId) : undefined;
    return {
      storageKey,
      resourceId: resourceId ?? null,
      size: statSync(path.join(legacyRoot, storageKey)).size,
      artifactDigest: createHash("sha256").update(bytes).digest("hex"),
      metadataReference: Boolean(resource),
      downloadUrl: resource ? `https://superskill.sh/api/resources/${encodeURIComponent(resource.id)}/archive` : null,
      migrationReady: false,
      missing: resource ? ["version", "canonical ownerSubject"] : ["resourceId", "catalog metadata", "version", "canonical ownerSubject"]
    };
  })
  : [];

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  reconciliation,
  legacy,
  imports,
  parity,
  summary: {
    legacyArchives: legacy.length,
    legacyWithMetadata: legacy.filter((item) => item.metadataReference).length,
    legacyReady: legacy.filter((item) => item.migrationReady).length,
    activeImports: imports.filter((item) => item.status === "active").length,
    parityFailures: parity.failures.length
  },
  next: "Add exact version and canonical user:<64-hex> ownerSubject to a reviewed migration manifest, then run migrate:resource-archives -- --manifest <file> --execute."
}, null, 2));

if (!parity.ok) process.exitCode = 1;

function decodeArchiveKey(file: string): string | undefined {
  try {
    const key = file.slice(0, -".tar.gz".length);
    const decoded = Buffer.from(key, "base64url").toString("utf8");
    return Buffer.from(decoded, "utf8").toString("base64url") === key ? decoded : undefined;
  } catch {
    return undefined;
  }
}
