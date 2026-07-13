import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import type { Resource } from "../src/resources.js";

const root = mkdtempSync(path.join(os.tmpdir(), "onlyharness-resource-releases-"));
process.env.HARNESS_WORKSPACE_ROOT = root;
process.env.RESOURCE_IMPORT_ARCHIVE_DIR = path.join(root, "import-archives");
process.env.RESOURCE_ARCHIVE_DIR = path.join(root, "legacy-archives");
process.env.RESOURCE_RELEASES_PATH = path.join(root, "releases.json");
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const releases = await import("../src/resource-releases.js");

test.after(() => rmSync(root, { recursive: true, force: true }));

test("Supabase migration enforces transactional ownership and one-way immutable metadata", () => {
  const migration = readFileSync(path.resolve(import.meta.dirname, "../../../supabase/migrations/20260713100000_resource_package_releases.sql"), "utf8");
  assert.match(migration, /resource_package_owners[\s\S]+resource_id text primary key/);
  assert.match(migration, /create or replace function public\.claim_resource_package_release/);
  assert.match(migration, /create or replace function public\.abort_resource_package_release/);
  assert.match(migration, /and status = 'pending'/);
  assert.match(migration, /p_release->>'status' is distinct from 'pending'/);
  assert.match(migration, /resource_package_release_transition_guard/);
  assert.match(migration, /old\.status <> 'pending' or new\.status not in \('active', 'failed'\)/);
  assert.match(migration, /revoke all on table public\.resource_package_releases from service_role/);
  assert.match(migration, /grant update \(status, activated_at, failed_at, failure_code\)/);
  assert.match(migration, /owner_subject text not null check \(owner_subject ~ '\^user:\[a-f0-9\]\{64\}\$'\)/);
  assert.doesNotMatch(migration, /grant (?:insert|delete|update on table) public\.resource_package_releases to service_role/i);
});

test("canonical archive is deterministic across file order and metadata noise", () => {
  const left = releases.buildCanonicalResourceArchive([
    { path: "skills/demo/SKILL.md", content: "# Demo\n" },
    { path: "README.md", content: "# Package\n" }
  ]);
  const right = releases.buildCanonicalResourceArchive([
    { path: "README.md", content: "# Package\n" },
    { path: "skills/demo/SKILL.md", content: "# Demo\n" }
  ]);
  assert.deepEqual(left, right);
  assert.equal(sha256(left), sha256(right));
  assert.deepEqual([...left.subarray(4, 8)], [0, 0, 0, 0]);
  assert.equal(left[9], 255);
});

test("direct release commit rejects duplicate normalized paths and oversized files before mutation", async () => {
  const before = durableMutationState();
  const duplicateInput = releaseInput("direct-duplicate", "1.0.0", "direct-duplicate-key-001", "direct-duplicate-owner", "# Duplicate\n");
  duplicateInput.files = [
    { path: "docs\\same.md", content: "one" },
    { path: "docs/same.md", content: "two" }
  ];
  const duplicate = await releases.commitResourceRelease(duplicateInput);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.deepEqual({ status: duplicate.status, code: duplicate.code }, { status: 400, code: "VALIDATION_FAILED" });
  assert.deepEqual(durableMutationState(), before);

  const oversizedInput = releaseInput("direct-oversized", "1.0.0", "direct-oversized-key-001", "direct-oversized-owner", "# Oversized\n");
  oversizedInput.files = [{ path: "docs/large.md", content: "x".repeat(256 * 1024 + 1) }];
  const oversized = await releases.commitResourceRelease(oversizedInput);
  assert.equal(oversized.ok, false);
  if (!oversized.ok) assert.deepEqual({ status: oversized.status, code: oversized.code }, { status: 400, code: "VALIDATION_FAILED" });
  assert.deepEqual(durableMutationState(), before);

  const windowsPaths = ["C:/secret.md", "C:\\secret.md", "C:secret.md", "\\\\server\\share\\secret.md", "//server/share/secret.md"];
  for (const [index, unsafePath] of windowsPaths.entries()) {
    const windowsInput = releaseInput(`direct-windows-${index}`, "1.0.0", `direct-windows-key-000${index}`, "direct-windows-owner", "# Unsafe\n");
    windowsInput.files = [{ path: unsafePath, content: "unsafe" }];
    const result = await releases.commitResourceRelease(windowsInput);
    assert.equal(result.ok, false, unsafePath);
    if (!result.ok) assert.deepEqual({ status: result.status, code: result.code }, { status: 400, code: "VALIDATION_FAILED" }, unsafePath);
    assert.deepEqual(durableMutationState(), before, unsafePath);
  }
});

test("legacy migration accepts only digest-bound safe deterministic tar.gz before pending mutation", async () => {
  mkdirSync(process.env.RESOURCE_ARCHIVE_DIR!, { recursive: true });
  const validInput = releaseInput("legacy-valid", "1.0.0", "legacy-valid-key-00001", "legacy-valid-owner", "# Legacy valid\n");
  const validArchive = releases.buildCanonicalResourceArchive(validInput.files);
  writeLegacyArchive(validInput.resource.id, validArchive);
  const valid = await releases.migrateLegacyResourceRelease({
    resource: validInput.resource,
    version: validInput.version,
    ownerSubject: validInput.ownerSubject,
    expectedDigest: sha256(validArchive)
  });
  assert.equal(valid.ok, true);
  assert.ok(releases.resourceArchivePathForRead(validInput.resource.id, validInput.version));

  const malicious: Array<{ name: string; archive: Buffer }> = [
    { name: "legacy-not-tar", archive: Buffer.alloc(20, 0x61) },
    { name: "legacy-traversal", archive: testTarGz([{ name: "../escape.md", type: "0", content: Buffer.from("bad") }]) },
    { name: "legacy-absolute", archive: testTarGz([{ name: "/etc/passwd", type: "0", content: Buffer.from("bad") }]) },
    { name: "legacy-drive-absolute", archive: testTarGz([{ name: "C:/escape.md", type: "0", content: Buffer.from("bad") }]) },
    { name: "legacy-drive-relative", archive: testTarGz([{ name: "C:escape.md", type: "0", content: Buffer.from("bad") }]) },
    { name: "legacy-unc-backslash", archive: testTarGz([{ name: "\\\\server\\share\\escape.md", type: "0", content: Buffer.from("bad") }]) },
    { name: "legacy-unc-slash", archive: testTarGz([{ name: "//server/share/escape.md", type: "0", content: Buffer.from("bad") }]) },
    { name: "legacy-symlink", archive: testTarGz([{ name: "docs/link.md", type: "2", content: Buffer.alloc(0) }]) },
    { name: "legacy-hardlink", archive: testTarGz([{ name: "docs/hard.md", type: "1", content: Buffer.alloc(0) }]) },
    { name: "legacy-device", archive: testTarGz([{ name: "docs/device", type: "3", content: Buffer.alloc(0) }]) },
    { name: "legacy-duplicate", archive: testTarGz([
      { name: "docs/readme.md", type: "0", content: Buffer.from("one") },
      { name: "./docs/readme.md", type: "0", content: Buffer.from("two") }
    ]) },
    { name: "legacy-file-too-large", archive: testTarGz([{ name: "docs/large.md", type: "0", content: Buffer.alloc(256 * 1024 + 1, 0x61) }]) },
    { name: "legacy-total-too-large", archive: testTarGz(Array.from({ length: 65 }, (_, index) => ({
      name: `docs/chunk-${index}.md`, type: "0" as const, content: Buffer.alloc(256 * 1024, 0x61)
    }))) }
  ];
  for (const fixture of malicious) {
    const input = releaseInput(fixture.name, "1.0.0", `${fixture.name}-key-0000001`, "legacy-malicious-owner", "# Invalid\n");
    writeLegacyArchive(input.resource.id, fixture.archive);
    const before = durableMutationState();
    const result = await releases.migrateLegacyResourceRelease({
      resource: input.resource,
      version: input.version,
      ownerSubject: input.ownerSubject,
      expectedDigest: sha256(fixture.archive)
    });
    assert.equal(result.ok, false, fixture.name);
    if (!result.ok) assert.deepEqual({ status: result.status, code: result.code }, { status: 400, code: "VALIDATION_FAILED" }, fixture.name);
    assert.deepEqual(durableMutationState(), before, fixture.name);
    assert.equal(releases.resourceReleaseInventory().some((release) => release.resourceId === input.resource.id), false, fixture.name);
  }
});

test("release commit is immutable, idempotent and active-only", async () => {
  const input = releaseInput("alpha", "0.1.0", "alpha-idempotency-key-0001", "owner-alpha", "# Alpha\n");
  const first = await releases.commitResourceRelease(input);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.replay, false);
  assert.equal(first.release.status, "active");
  assert.equal(first.release.trust, "unreviewed");
  assert.match(first.release.artifactDigest, /^[a-f0-9]{64}$/);
  assert.equal(releases.activeReleaseArchivePath(input.resource.id) !== undefined, true);
  assert.equal(releases.readActiveReleaseResourcesSync().some((resource) => resource.id === input.resource.id), true);

  const replay = await releases.commitResourceRelease(input);
  assert.equal(replay.ok, true);
  if (replay.ok) {
    assert.equal(replay.replay, true);
    assert.equal(replay.release.id, first.release.id);
    assert.equal(replay.release.artifactDigest, first.release.artifactDigest);
  }

  const changedSameKey = await releases.commitResourceRelease({ ...input, files: [{ path: "README.md", content: "# Changed\n" }] });
  assert.deepEqual(changedSameKey.ok ? undefined : changedSameKey.code, "PUBLISH_CONFLICT");

  const changedSameVersion = await releases.commitResourceRelease({ ...input, idempotencyKey: "alpha-idempotency-key-0002", files: [{ path: "README.md", content: "# Changed\n" }] });
  assert.deepEqual(changedSameVersion.ok ? undefined : changedSameVersion.code, "PUBLISH_CONFLICT");
});

test("resource ownership is immutable across versions", async () => {
  const first = releaseInput("owned", "1.0.0", "owned-idempotency-key-001", "owner-one", "# One\n");
  assert.equal((await releases.commitResourceRelease(first)).ok, true);
  const takeover = await releases.commitResourceRelease({
    ...releaseInput("owned", "1.1.0", "owned-idempotency-key-002", "owner-two", "# Two\n")
  });
  assert.equal(takeover.ok, false);
  if (!takeover.ok) assert.equal(takeover.code, "PUBLISH_CONFLICT");
});

test("catalog projects latest semver while exact older archives survive reconciliation", async () => {
  const v1 = releaseInput("versions", "1.0.0", "versions-key-000000001", "versions-owner", "# V1\n");
  v1.resource.title = "versions-v1";
  const first = await releases.commitResourceRelease(v1);
  assert.equal(first.ok, true);
  const v2 = releaseInput("versions", "2.0.0", "versions-key-000000002", "versions-owner", "# V2\n");
  v2.resource.title = "versions-v2";
  const second = await releases.commitResourceRelease(v2);
  assert.equal(second.ok, true);
  const projected = releases.readActiveReleaseResourcesSync().filter((resource) => resource.id === v1.resource.id);
  assert.equal(projected.length, 1);
  assert.equal(projected[0]?.title, "versions-v2");
  const v1Path = releases.resourceArchivePathForRead(v1.resource.id, "1.0.0");
  const v2Path = releases.resourceArchivePathForRead(v1.resource.id, "2.0.0");
  assert.ok(v1Path);
  assert.ok(v2Path);
  assert.notEqual(sha256(readFileSync(v1Path)), sha256(readFileSync(v2Path)));
  const reconciliation = await releases.reconcileResourceReleases();
  assert.equal(reconciliation.store, "local");
  assert.equal(releases.resourceArchivePathForRead(v1.resource.id, "1.0.0"), v1Path);
});

test("legacy read fallback is allowed only when it matches active migrated digest", async () => {
  const input = releaseInput("fallback", "1.0.0", "fallback-key-000000001", "fallback-owner", "# Fallback\n");
  const result = await releases.commitResourceRelease(input);
  assert.equal(result.ok, true);
  const imported = releases.activeReleaseArchivePath(input.resource.id);
  assert.ok(imported);
  const exactBytes = readFileSync(imported);
  mkdirSync(process.env.RESOURCE_ARCHIVE_DIR!, { recursive: true });
  const legacy = path.join(process.env.RESOURCE_ARCHIVE_DIR!, `${Buffer.from(input.resource.id).toString("base64url")}.tar.gz`);
  copyFileSync(imported, legacy);
  rmSync(imported);
  assert.equal(releases.resourceArchivePathForRead(input.resource.id), legacy);
  writeFileSync(legacy, "wrong legacy payload");
  assert.equal(releases.resourceArchivePathForRead(input.resource.id), undefined);
  writeFileSync(legacy, exactBytes);
  assert.equal(releases.resourceArchivePathForRead(input.resource.id), legacy);
});

test("inventory reports digest and size parity and fails closed on corruption", () => {
  const target = releases.activeReleaseArchivePath("onlyharness:packages/versions", "2.0.0");
  assert.ok(target);
  const bytes = readFileSync(target);
  const clean = releases.verifyResourceReleaseInventory();
  assert.equal(clean.ok, true);
  writeFileSync(target, "corrupt");
  const corrupt = releases.verifyResourceReleaseInventory();
  assert.equal(corrupt.ok, false);
  assert.ok(corrupt.failures.some((failure) => failure.resourceId === "onlyharness:packages/versions" && failure.version === "2.0.0"));
  writeFileSync(target, bytes);
  assert.equal(releases.verifyResourceReleaseInventory().ok, true);
});

test("public metadata rejects email-like creator identity before durable mutation", async () => {
  const input = releaseInput("email-leak", "1.0.0", "email-leak-key-000001", "email-owner", "# Email\n");
  input.resource.creatorName = "publisher@example.com";
  const result = await releases.commitResourceRelease(input);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "PUBLISH_CONFLICT");
  assert.equal(releases.readActiveReleaseResourcesSync().some((resource) => resource.id === input.resource.id), false);
});

test("concurrent retries create one active release and preserve cross-resource idempotency uniqueness", async () => {
  const input = releaseInput("parallel", "2.0.0", "parallel-idempotency-001", "parallel-owner", "# Parallel\n");
  const results = await Promise.all([releases.commitResourceRelease(input), releases.commitResourceRelease(input)]);
  assert.equal(results.every((result) => result.ok), true);
  assert.equal(results.filter((result) => result.ok && result.replay).length, 1);

  const sharedKey = "cross-resource-key-0000001";
  const cross = await Promise.all([
    releases.commitResourceRelease(releaseInput("cross-a", "1.0.0", sharedKey, "cross-owner", "# A\n")),
    releases.commitResourceRelease(releaseInput("cross-b", "1.0.0", sharedKey, "cross-owner", "# B\n"))
  ]);
  assert.equal(cross.filter((result) => result.ok).length, 1);
  assert.equal(cross.filter((result) => !result.ok && result.code === "PUBLISH_CONFLICT").length, 1);
});

test("Supabase conflict-race replay never returns success until winner projection verifies", async () => {
  const input = releaseInput("supabase-race-replay", "1.0.0", "supabase-race-key-0001", "supabase-race-owner", "# Race winner\n");
  const archive = releases.buildCanonicalResourceArchive(input.files);
  const row = supabaseReleaseRow(input, archive, "40000000-0000-4000-8000-000000000001");
  mkdirSync(process.env.RESOURCE_IMPORT_ARCHIVE_DIR!, { recursive: true });
  writeFileSync(path.join(process.env.RESOURCE_IMPORT_ARCHIVE_DIR!, row.storage_key), archive);
  const originalFetch = globalThis.fetch;
  let releaseReads = 0;
  process.env.SUPABASE_URL = "https://supabase.release.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  globalThis.fetch = (async (url) => {
    const target = String(url);
    if (target.includes("/rpc/claim_resource_package_release")) return new Response("{}", { status: 409 });
    if (target.includes("/rest/v1/resource_package_releases")) {
      releaseReads += 1;
      return Response.json(releaseReads === 1 ? [] : [row]);
    }
    throw new Error(`Unexpected Supabase release request: ${target}`);
  }) as typeof fetch;
  process.env.RESOURCE_RELEASE_FAULT_AT = "after_projection_write";
  try {
    const ambiguous = await releases.commitResourceRelease(input);
    assert.equal(ambiguous.ok, false);
    if (!ambiguous.ok) assert.deepEqual({ status: ambiguous.status, code: ambiguous.code }, { status: 503, code: "ARCHIVE_STORAGE_UNAVAILABLE" });
    delete process.env.RESOURCE_RELEASE_FAULT_AT;
    const replay = await releases.commitResourceRelease(input);
    assert.equal(replay.ok, true);
    if (replay.ok) assert.equal(replay.replay, true);
    assert.ok(releases.resourceArchivePathForRead(input.resource.id, input.version));
  } finally {
    delete process.env.RESOURCE_RELEASE_FAULT_AT;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    globalThis.fetch = originalFetch;
  }
});

test("Supabase release snapshots fail closed on any malformed row or payload identity mismatch", async () => {
  const input = releaseInput("supabase-malformed-snapshot", "1.0.0", "supabase-malformed-key-1", "supabase-malformed-owner", "# Malformed\n");
  const archive = releases.buildCanonicalResourceArchive(input.files);
  const valid = supabaseReleaseRow(input, archive, "50000000-0000-4000-8000-000000000001");
  const malformedRows = [
    { ...valid, id: "50000000-0000-4000-8000-000000000002", archive_size: "not-a-number" },
    { ...valid, id: "50000000-0000-4000-8000-000000000003", resource_payload: { ...valid.resource_payload, identity: { scheme: "onlyharness", key: "packages/wrong-identity" } } },
    { ...valid, id: "50000000-0000-4000-8000-000000000004", resource_payload: withoutResourceField(valid.resource_payload, "title") },
    { ...valid, id: "50000000-0000-4000-8000-000000000005", resource_payload: withoutResourceField(valid.resource_payload, "tags") },
    { ...valid, id: "50000000-0000-4000-8000-000000000006", resource_payload: withoutResourceField(valid.resource_payload, "worksWith") },
    { ...valid, id: "50000000-0000-4000-8000-000000000007", resource_payload: withoutResourceField(valid.resource_payload, "actions") },
    { ...valid, id: "50000000-0000-4000-8000-000000000008", resource_payload: { ...valid.resource_payload, token: "ghp_abcdefghijklmnopqrstuvwxyz" } }
  ];
  const originalFetch = globalThis.fetch;
  process.env.SUPABASE_URL = "https://supabase.release.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  try {
    for (const malformed of malformedRows) {
      const before = durableMutationState();
      globalThis.fetch = (async (url) => {
        if (String(url).includes("/rest/v1/resource_package_releases")) return Response.json([valid, malformed]);
        throw new Error(`Unexpected Supabase release request: ${String(url)}`);
      }) as typeof fetch;
      const result = await releases.commitResourceRelease(input);
      assert.equal(result.ok, false);
      if (!result.ok) assert.deepEqual({ status: result.status, code: result.code }, { status: 503, code: "ARCHIVE_STORAGE_UNAVAILABLE" });
      assert.deepEqual(durableMutationState(), before);
    }
  } finally {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    globalThis.fetch = originalFetch;
  }
});

for (const boundary of ["before_temp_write", "before_file_fsync", "before_archive_rename", "before_parent_fsync", "after_archive_rename", "before_metadata_activation", "before_projection_sync"]) {
  test(`fault at ${boundary} leaves no active release or committed archive`, async () => {
    process.env.RESOURCE_RELEASE_FAULT_AT = boundary;
    const name = `fault-${boundary.replaceAll("_", "-")}`;
    try {
      const result = await releases.commitResourceRelease(releaseInput(name, "1.0.0", `${name}-idempotency-key`, "fault-owner", `# ${boundary}\n`));
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "ARCHIVE_STORAGE_UNAVAILABLE");
      assert.equal(releases.activeReleaseArchivePath(`onlyharness:packages/${name}`), undefined);
      assert.equal(releases.readActiveReleaseResourcesSync().some((resource) => resource.id === `onlyharness:packages/${name}`), false);
      assert.equal(releases.resourceReleaseInventory().some((release) => release.resourceId === `onlyharness:packages/${name}`), false);
      const committed = readdirSync(process.env.RESOURCE_IMPORT_ARCHIVE_DIR!).filter((file) => file.endsWith(".tar.gz"));
      assert.equal(committed.some((file) => file.includes(Buffer.from(`onlyharness:packages/${name}@1.0.0`).toString("base64url"))), false);
    } finally {
      delete process.env.RESOURCE_RELEASE_FAULT_AT;
    }
  });
}

test("active durable release recovers after local projection write ambiguity", async () => {
  const input = releaseInput("projection-recovery", "1.0.0", "projection-recovery-key", "projection-owner", "# Projection\n");
  process.env.RESOURCE_RELEASE_FAULT_AT = "after_projection_write";
  try {
    const ambiguous = await releases.commitResourceRelease(input);
    assert.equal(ambiguous.ok, false);
    if (!ambiguous.ok) assert.equal(ambiguous.code, "ARCHIVE_STORAGE_UNAVAILABLE");
  } finally {
    delete process.env.RESOURCE_RELEASE_FAULT_AT;
  }
  const reconciliation = await releases.reconcileResourceReleases();
  assert.equal(reconciliation.store, "local");
  const replay = await releases.commitResourceRelease(input);
  assert.equal(replay.ok, true);
  if (replay.ok) assert.equal(replay.replay, true);
  assert.ok(releases.resourceArchivePathForRead(input.resource.id, input.version));
});

test("malformed local resource rows invalidate the whole release projection and search never crashes", async () => {
  const releasePath = process.env.RESOURCE_RELEASES_PATH!;
  const parsed = JSON.parse(readFileSync(releasePath, "utf8")) as { releases: Array<Record<string, unknown>>; owners: unknown[] };
  assert.ok(parsed.releases.length > 0);
  const malformed = structuredClone(parsed.releases[0]);
  delete (malformed.resource as Record<string, unknown>).actions;
  writeFileSync(releasePath, `${JSON.stringify({ schemaVersion: 1, owners: parsed.owners, releases: [...parsed.releases, malformed] }, null, 2)}\n`);
  assert.deepEqual(releases.readActiveReleaseResourcesSync(), []);
  const resourceCatalog = await import("../src/resources.js");
  assert.doesNotThrow(() => resourceCatalog.searchResources({ q: "anything" }, []));
  assert.equal(resourceCatalog.searchResources({ q: "anything" }, []).resources.length, 0);
});

test("corrupt local metadata fails closed and is not overwritten", async () => {
  const releasePath = process.env.RESOURCE_RELEASES_PATH!;
  writeFileSync(releasePath, "{not-json\n");
  const result = await releases.commitResourceRelease(releaseInput("corrupt-store", "1.0.0", "corrupt-store-key-0001", "corrupt-owner", "# Corrupt\n"));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "ARCHIVE_STORAGE_UNAVAILABLE");
  assert.equal(readFileSync(releasePath, "utf8"), "{not-json\n");
  assert.equal(existsSync(path.join(process.env.RESOURCE_IMPORT_ARCHIVE_DIR!, `${Buffer.from("onlyharness:packages/corrupt-store@1.0.0").toString("base64url")}.tar.gz`)), false);
});

function releaseInput(name: string, version: string, idempotencyKey: string, ownerSeed: string, content: string) {
  const resource = fixtureResource(name);
  const files = [{ path: "README.md", content }];
  return {
    resource,
    version,
    idempotencyKey,
    ownerSubject: `user:${sha256(Buffer.from(ownerSeed, "utf8"))}`,
    payloadDigest: releases.canonicalPayloadDigest({
      name,
      version,
      resourceType: "skill",
      title: resource.title,
      summary: resource.summary,
      worksWith: resource.worksWith,
      tags: resource.tags,
      files
    }),
    files
  };
}

function fixtureResource(name: string): Resource {
  const now = "2026-07-13T00:00:00.000Z";
  const id = `onlyharness:packages/${name}`;
  return {
    id,
    identity: { scheme: "onlyharness", key: `packages/${name}` },
    title: name,
    summary: `Fixture ${name}`,
    resourceType: "skill",
    sourcePlatform: "manual",
    canonicalUrl: `https://onlyharness.com/#/resources/${encodeURIComponent(id)}`,
    upstreamId: `packages/${name}`,
    upstreamOwner: "onlyharness",
    upstreamRepo: name,
    creatorName: "OnlyHarness publisher",
    licenseStatus: "unknown",
    sourceCheckedAt: now,
    sourceCheckMethod: "manual_research",
    sourceCheckStatus: "active",
    lastSeenAt: now,
    installability: "importable",
    tags: ["skill", "hosted"],
    worksWith: ["codex"],
    upstreamPopularity: { sourceLabel: "OnlyHarness hosted resource package" },
    onlyHarnessSignals: { stars: 0, opens: 0, imports: 1, installs: 0, threads: 0, passedGates: 0 },
    popularityScore: 0,
    popularityBreakdown: { upstreamScore: 0, onlyHarnessScore: 0, freshnessBoost: 0, riskPenalty: 0 },
    trust: { sourceChecked: true, securityScan: "not_scanned", riskTier: "UNKNOWN" },
    actions: [
      { id: "open_onlyharness", label: "Use", url: `https://onlyharness.com/#/resources/${encodeURIComponent(id)}` },
      { id: "download_archive", label: "Download", url: `https://onlyharness.com/api/resources/${encodeURIComponent(id)}/archive` }
    ]
  };
}

function durableMutationState(): { releases: string | null; imports: string[] } {
  return {
    releases: existsSync(process.env.RESOURCE_RELEASES_PATH!) ? readFileSync(process.env.RESOURCE_RELEASES_PATH!, "utf8") : null,
    imports: existsSync(process.env.RESOURCE_IMPORT_ARCHIVE_DIR!) ? readdirSync(process.env.RESOURCE_IMPORT_ARCHIVE_DIR!).sort() : []
  };
}

function writeLegacyArchive(resourceId: string, archive: Buffer): void {
  const target = path.join(process.env.RESOURCE_ARCHIVE_DIR!, `${Buffer.from(resourceId, "utf8").toString("base64url")}.tar.gz`);
  writeFileSync(target, archive);
}

function testTarGz(entries: Array<{ name: string; type: "0" | "1" | "2" | "3" | "5"; content: Buffer }>): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    Buffer.from(entry.name, "utf8").copy(header, 0, 0, 100);
    writeTestTarOctal(header, 0o644, 100, 8);
    writeTestTarOctal(header, 0, 108, 8);
    writeTestTarOctal(header, 0, 116, 8);
    writeTestTarOctal(header, entry.content.length, 124, 12);
    writeTestTarOctal(header, 0, 136, 12);
    header.fill(0x20, 148, 156);
    header.write(entry.type, 156, 1, "ascii");
    header.write("ustar", 257, 5, "ascii");
    header.write("00", 263, 2, "ascii");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, "0"), 148, 6, "ascii");
    header[154] = 0;
    header[155] = 0x20;
    blocks.push(header, entry.content);
    const padding = (512 - (entry.content.length % 512)) % 512;
    if (padding) blocks.push(Buffer.alloc(padding));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks), { level: 9 });
}

function writeTestTarOctal(buffer: Buffer, value: number, offset: number, length: number): void {
  buffer.write(value.toString(8).padStart(length - 1, "0"), offset, length - 1, "ascii");
  buffer[offset + length - 1] = 0;
}

function supabaseReleaseRow(input: ReturnType<typeof releaseInput>, archive: Buffer, id: string) {
  return {
    id,
    resource_id: input.resource.id,
    version: input.version,
    owner_subject: input.ownerSubject,
    idempotency_key_hash: `sha256:${sha256(Buffer.from(input.idempotencyKey, "utf8"))}`,
    payload_digest: input.payloadDigest,
    artifact_digest: sha256(archive),
    archive_size: archive.length,
    storage_key: `${Buffer.from(`${input.resource.id}@${input.version}`, "utf8").toString("base64url")}.tar.gz`,
    status: "active",
    trust: "unreviewed",
    resource_payload: input.resource,
    created_at: "2026-07-13T00:00:00.000Z",
    activated_at: "2026-07-13T00:00:01.000Z",
    failed_at: null,
    failure_code: null
  };
}

function withoutResourceField(resource: Resource, field: keyof Resource): Record<string, unknown> {
  const copy = { ...resource } as Record<string, unknown>;
  delete copy[field];
  return copy;
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
