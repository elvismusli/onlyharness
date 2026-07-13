import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import * as resources from "../apps/harness-api/src/resources.js";
import { reconcileResourceReleases, resourceReleaseInventory, verifyResourceReleaseInventory } from "../apps/harness-api/src/resource-releases.js";

export type LegacyArchiveClassification =
  | "external_legacy_mirror"
  | "hosted_package_candidate"
  | "unknown_legacy_archive";

export function inventoryMode(args: string[]): { readOnly: boolean; reconcile: boolean } {
  const reconcile = args.includes("--reconcile");
  return { readOnly: !reconcile, reconcile };
}

export function classifyLegacyArchive(resourceId: string | undefined): {
  classification: LegacyArchiveClassification;
  migrationAction: "retire_not_migrate" | "review_hosted_package_manifest" | "quarantine_and_review";
  migrationReady: false;
  missing: string[];
} {
  if (resourceId?.startsWith("github:")) {
    return {
      classification: "external_legacy_mirror",
      migrationAction: "retire_not_migrate",
      migrationReady: false,
      missing: ["retirement approval after open-only catalog and traffic verification"]
    };
  }
  if (resourceId?.startsWith("onlyharness:packages/")) {
    return {
      classification: "hosted_package_candidate",
      migrationAction: "review_hosted_package_manifest",
      migrationReady: false,
      missing: ["version", "canonical ownerSubject", "reviewed artifactDigest manifest"]
    };
  }
  return {
    classification: "unknown_legacy_archive",
    migrationAction: "quarantine_and_review",
    migrationReady: false,
    missing: ["recognized resourceId", "catalog metadata", "retention decision"]
  };
}

async function main() {
  const mode = inventoryMode(process.argv.slice(2));
  const reconciliation = mode.reconcile
    ? await reconcileResourceReleases()
    : {
        store: "skipped" as const,
        reason: "read_only_default",
        next: "Pass --reconcile only in an approved maintenance window; reconciliation may change release state and delete stale archive objects."
      };
  if (mode.reconcile && reconciliation.store === "unavailable") {
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
      const classification = classifyLegacyArchive(resourceId);
      return {
        storageKey,
        resourceId: resourceId ?? null,
        size: statSync(path.join(legacyRoot, storageKey)).size,
        artifactDigest: createHash("sha256").update(bytes).digest("hex"),
        metadataReference: Boolean(resource),
        downloadUrl: resource ? `https://superskill.sh/api/resources/${encodeURIComponent(resource.id)}/archive` : null,
        ...classification
      };
    })
    : [];

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    mode,
    reconciliation,
    legacy,
    imports,
    parity,
    summary: {
      legacyArchives: legacy.length,
      legacyWithMetadata: legacy.filter((item) => item.metadataReference).length,
      externalLegacyMirrors: legacy.filter((item) => item.classification === "external_legacy_mirror").length,
      hostedPackageCandidates: legacy.filter((item) => item.classification === "hosted_package_candidate").length,
      unknownLegacyArchives: legacy.filter((item) => item.classification === "unknown_legacy_archive").length,
      retireNotMigrate: legacy.filter((item) => item.migrationAction === "retire_not_migrate").length,
      migrationReady: legacy.filter((item) => item.migrationReady).length,
      activeImports: imports.filter((item) => item.status === "active").length,
      parityFailures: parity.failures.length
    },
    next: [
      "Do not put github:* mirrors into resource_package_releases or invent an owner/version; verify open-only catalog behavior, preserve a cold backup, then retire those legacy objects.",
      "Only reviewed onlyharness:packages/* candidates may use migrate:resource-archives with exact version, canonical ownerSubject, and artifactDigest.",
      "The default inventory is read-only. Use --reconcile separately only after approving its release-state and archive-cleanup mutations."
    ]
  }, null, 2));

  if (!parity.ok) process.exitCode = 1;
}

function decodeArchiveKey(file: string): string | undefined {
  try {
    const key = file.slice(0, -".tar.gz".length);
    const decoded = Buffer.from(key, "base64url").toString("utf8");
    return Buffer.from(decoded, "utf8").toString("base64url") === key ? decoded : undefined;
  } catch {
    return undefined;
  }
}

const isMain = process.argv[1] ? import.meta.url === new URL(process.argv[1], "file:").href : false;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
