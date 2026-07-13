import { probeResourceImportArchiveStorage, reconcileResourceReleases, verifyResourceReleaseInventory } from "../apps/harness-api/src/resource-releases.js";

const probe = probeResourceImportArchiveStorage();
if (!probe.ok) {
  console.error(JSON.stringify({ ok: false, code: probe.code }));
  process.exit(1);
}

const reconciliation = await reconcileResourceReleases({ pendingMaxAgeMs: 0 });
if (reconciliation.store === "unavailable") {
  console.error(JSON.stringify({ ok: false, code: "RELEASE_STORE_UNAVAILABLE" }));
  process.exit(1);
}

const inventory = verifyResourceReleaseInventory();
if (!inventory.ok) {
  console.error(JSON.stringify({ ok: false, code: "ARCHIVE_PARITY_FAILED", failures: inventory.failures }));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, code: "RESOURCE_IMPORT_STORAGE_READY", reconciliation, inventory }));
