import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import YAML from "yaml";
import { canonicalArtifactDigest } from "@harnesshub/capability-schema/node";
import { installHostedCatalogSkill, resourceInstallEventCoordinates } from "../src/lib/resource-skill-install.js";
import { SuperSkillCliError } from "../src/lib/superskill-types.js";

const registry = "https://superskill.sh/api";
const resourceId = "onlyharness:packages/clean-user-skill";
const archiveUrl = `https://superskill.sh/api/resources/${encodeURIComponent(resourceId)}/releases/0.1.1/archive`;
const skill = `---\nname: clean-user-skill\ndescription: "Clean test skill"\n---\n\n# Clean user skill\n`;
const archive = tarGz([
  { name: "README.md", content: Buffer.from("# Clean user skill\n") },
  { name: "SKILL.md", content: Buffer.from(skill) }
]);
const archiveDigest = `sha256:${createHash("sha256").update(archive).digest("hex")}`;
const nativeResourceId = "onlyharness:harnesses/deep-market-researcher";
const nativeVersion = "0.2.1";
const nativeManifestText = readFileSync(path.resolve(import.meta.dirname, "../../../seed-harnesses/deep-market-researcher/harness.yaml"), "utf8");
const nativeFiles = [
  { path: "README.md", content: "# Native harness\n", truncated: false },
  { path: "harness.yaml", content: nativeManifestText, truncated: false }
];
const nativeDigest = canonicalArtifactDigest({ files: nativeFiles, totalFileCount: nativeFiles.length, archiveTruncated: false });

test("explicit unreviewed hosted skill install routes to Codex and is idempotent", async () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "superskill-resource-install-"));
  try {
    const fetchImpl = fixtureFetch();
    await assert.rejects(
      () => installHostedCatalogSkill({ registryUrl: registry, resourceId, version: "0.1.1", expectedDigest: archiveDigest, client: "codex", projectDir: project, fetchImpl }),
      hasReason("RESOURCE_REVIEW_REQUIRED")
    );
    const installed = await installHostedCatalogSkill({
      registryUrl: registry,
      resourceId,
      version: "0.1.1",
      expectedDigest: archiveDigest,
      client: "codex",
      projectDir: project,
      allowUnreviewed: true,
      fetchImpl
    });
    assert.equal(installed.status, "installed");
    assert.equal(installed.target, ".agents/skills/clean-user-skill");
    assert.equal(installed.trust.managedApproval, false);
    assert.match(installed.warning ?? "", /unreviewed/);
    assert.equal(readFileSync(path.join(project, installed.target, "SKILL.md"), "utf8"), skill);
    assert.doesNotMatch(readFileSync(path.join(project, installed.target, ".superskill-resource.json"), "utf8"), /token|email|path/i);

    const repeated = await installHostedCatalogSkill({
      registryUrl: registry,
      resourceId,
      version: "0.1.1",
      expectedDigest: archiveDigest,
      client: "codex",
      projectDir: project,
      allowUnreviewed: true,
      fetchImpl
    });
    assert.equal(repeated.status, "unchanged");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("hosted skill install routes to Claude and dry-run writes nothing", async () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "superskill-resource-plan-"));
  try {
    const planned = await installHostedCatalogSkill({
      registryUrl: registry,
      resourceId,
      version: "0.1.1",
      expectedDigest: archiveDigest,
      client: "claude-code",
      projectDir: project,
      allowUnreviewed: true,
      dryRun: true,
      fetchImpl: fixtureFetch()
    });
    assert.equal(planned.status, "planned");
    assert.equal(planned.target, ".claude/skills/clean-user-skill");
    assert.match(planned.warning ?? "", /planned/);
    assert.match(planned.warning ?? "", /no files were installed/);
    assert.doesNotMatch(planned.warning ?? "", /^Installed/);
    assert.equal(readOptional(path.join(project, planned.target)), undefined);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("exact hosted skill install requests the immutable release detail route", async () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "superskill-resource-exact-"));
  const requested: string[] = [];
  const fetchImpl: typeof fetch = (async (input) => {
    requested.push(String(input));
    return fixtureFetch()(input);
  }) as typeof fetch;
  try {
    const planned = await installHostedCatalogSkill({
      registryUrl: registry,
      resourceId,
      version: "0.1.1",
      expectedDigest: archiveDigest,
      client: "codex",
      projectDir: project,
      allowUnreviewed: true,
      dryRun: true,
      fetchImpl
    });
    assert.equal(planned.version, "0.1.1");
    assert.equal(requested[0], `${registry}/resources/${encodeURIComponent(resourceId)}/releases/0.1.1`);
    assert.equal(requested[1], archiveUrl);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

for (const [label, releaseOverride] of [
  ["version", { version: "0.1.0" }],
  ["digest", { artifactDigest: "0".repeat(64) }],
  ["size", { archiveSize: archive.length + 1 }],
  ["trust", { trust: "verified" }]
] as const) {
  test(`hosted skill install rejects immutable detail/archive ${label} mismatch`, async () => {
    const project = mkdtempSync(path.join(os.tmpdir(), "superskill-resource-tuple-"));
    let requests = 0;
    const fetchImpl = fixtureFetch(archiveUrl, releaseOverride, () => { requests += 1; });
    try {
      await assert.rejects(
        () => installHostedCatalogSkill({ registryUrl: registry, resourceId, version: "0.1.1", expectedDigest: archiveDigest, client: "codex", projectDir: project, allowUnreviewed: true, fetchImpl }),
        hasReason("RESOURCE_ARCHIVE_INVALID")
      );
      if (label === "version" || label === "trust") assert.equal(requests, 1);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
}

test("failing static scan blocks hosted skill before archive download", async () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "superskill-resource-blocked-"));
  let requests = 0;
  const fetchImpl: typeof fetch = (async () => {
    requests += 1;
    return new Response(JSON.stringify({
      id: resourceId,
      resourceType: "skill",
      installability: "importable",
      upstreamRepo: "clean-user-skill",
      trust: { securityScan: "fail", riskTier: "CRITICAL" },
      release: {
        version: "0.1.1",
        artifactDigest: createHash("sha256").update(archive).digest("hex"),
        archiveSize: archive.length,
        trust: "unreviewed"
      },
      actions: [{ id: "download_archive", url: archiveUrl }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    await assert.rejects(
      () => installHostedCatalogSkill({ registryUrl: registry, resourceId, version: "0.1.1", expectedDigest: archiveDigest, client: "codex", projectDir: project, allowUnreviewed: true, fetchImpl }),
      hasReason("RESOURCE_BLOCKED")
    );
    assert.equal(requests, 1);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("hosted skill install rejects cross-origin archives and symlinked native roots", async () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "superskill-resource-guards-"));
  const outside = mkdtempSync(path.join(os.tmpdir(), "superskill-resource-outside-"));
  try {
    await assert.rejects(
      () => installHostedCatalogSkill({
        registryUrl: registry,
        resourceId,
        version: "0.1.1",
        expectedDigest: archiveDigest,
        client: "codex",
        projectDir: project,
        allowUnreviewed: true,
        fetchImpl: fixtureFetch("https://attacker.example/skill.tar.gz")
      }),
      hasReason("RESOURCE_ARCHIVE_INVALID")
    );
    symlinkSync(outside, path.join(project, ".agents"));
    await assert.rejects(
      () => installHostedCatalogSkill({
        registryUrl: registry,
        resourceId,
        version: "0.1.1",
        expectedDigest: archiveDigest,
        client: "codex",
        projectDir: project,
        allowUnreviewed: true,
        fetchImpl: fixtureFetch()
      }),
      hasReason("TARGET_UNSAFE")
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("exact public native harness install is anonymous, atomic and idempotent for Codex", async () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "superskill-native-harness-"));
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = nativeFixtureFetch({}, requests);
  try {
    const installed = await installHostedCatalogSkill({
      registryUrl: registry,
      resourceId: nativeResourceId,
      version: nativeVersion,
      expectedDigest: nativeDigest,
      client: "codex",
      projectDir: project,
      fetchImpl
    });
    assert.equal(installed.status, "installed");
    assert.equal(installed.resourceType, "harness");
    assert.equal(installed.target, ".agents/skills/deep-market-researcher");
    assert.equal(installed.harnessRoot, ".superskill/harnesses/deep-market-researcher");
    assert.equal(installed.archiveDigest, nativeDigest);
    assert.deepEqual(resourceInstallEventCoordinates(installed), { owner: "harnesses", repo: "deep-market-researcher" });
    assert.match(readFileSync(path.join(project, installed.target, "SKILL.md"), "utf8"), /not managed approval or Verified evidence/);
    assert.equal(readFileSync(path.join(project, installed.harnessRoot!, "harness.yaml"), "utf8"), nativeManifestText);
    assert.ok(requests.every(({ init }) => new Headers(init?.headers).get("authorization") === null));
    assert.ok(requests.every(({ init }) => init?.redirect === "error"));

    const repeated = await installHostedCatalogSkill({
      registryUrl: registry,
      resourceId: nativeResourceId,
      version: nativeVersion,
      expectedDigest: nativeDigest,
      client: "codex",
      projectDir: project,
      fetchImpl
    });
    assert.equal(repeated.status, "unchanged");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("exact public native harness dry-run routes to Claude without writes", async () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "superskill-native-plan-"));
  try {
    const planned = await installHostedCatalogSkill({
      registryUrl: registry,
      resourceId: nativeResourceId,
      version: nativeVersion,
      expectedDigest: nativeDigest,
      client: "claude-code",
      projectDir: project,
      dryRun: true,
      fetchImpl: nativeFixtureFetch()
    });
    assert.equal(planned.status, "planned");
    assert.equal(planned.target, ".claude/skills/deep-market-researcher");
    assert.equal(readOptional(path.join(project, planned.target)), undefined);
    assert.equal(readOptional(path.join(project, planned.harnessRoot!)), undefined);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

for (const [label, overrides] of [
  ["resource identity", { resource: { upstreamId: "attacker/other" } }],
  ["missing exact tuple", { resource: { nativeInstall: null } }],
  ["scan failure", { detail: { security: { verdict: "fail", scanner: "static-v2" } } }],
  ["scan digest drift", { detail: { nativeInstall: { scannedArtifactDigest: `sha256:${"0".repeat(64)}` } } }],
  ["non snapshot", { archive: { snapshot: false } }],
  ["truncated archive", { archive: { archiveTruncated: true } }],
  ["digest mismatch", { archive: { artifactDigest: `sha256:${"0".repeat(64)}` } }],
  ["traversal", { archive: { files: [{ path: "../escape", content: "bad", truncated: false }] } }]
] as const) {
  test(`native harness install rejects ${label} before final writes`, async () => {
    const project = mkdtempSync(path.join(os.tmpdir(), "superskill-native-reject-"));
    try {
      await assert.rejects(
        () => installHostedCatalogSkill({
          registryUrl: registry,
          resourceId: nativeResourceId,
          version: nativeVersion,
          expectedDigest: nativeDigest,
          client: "codex",
          projectDir: project,
          fetchImpl: nativeFixtureFetch(overrides)
        }),
        (error: unknown) => error instanceof SuperSkillCliError && ["RESOURCE_NOT_INSTALLABLE", "RESOURCE_BLOCKED", "RESOURCE_ARCHIVE_INVALID"].includes(error.reasonCode)
      );
      assert.equal(readOptional(path.join(project, ".superskill/harnesses/deep-market-researcher")), undefined);
      assert.equal(readOptional(path.join(project, ".agents/skills/deep-market-researcher")), undefined);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
}

test("native harness install rejects redirected responses and target collisions", async () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "superskill-native-guards-"));
  try {
    await assert.rejects(
      () => installHostedCatalogSkill({
        registryUrl: registry,
        resourceId: nativeResourceId,
        version: nativeVersion,
        expectedDigest: nativeDigest,
        client: "codex",
        projectDir: project,
        fetchImpl: nativeFixtureFetch({ redirect: true })
      }),
      hasReason("RESOURCE_FETCH_FAILED")
    );
    const collision = path.join(project, ".agents/skills/deep-market-researcher");
    await import("node:fs").then(({ mkdirSync, writeFileSync }) => {
      mkdirSync(collision, { recursive: true });
      writeFileSync(path.join(collision, "SKILL.md"), "different");
    });
    await assert.rejects(
      () => installHostedCatalogSkill({
        registryUrl: registry,
        resourceId: nativeResourceId,
        version: nativeVersion,
        expectedDigest: nativeDigest,
        client: "codex",
        projectDir: project,
        fetchImpl: nativeFixtureFetch()
      }),
      hasReason("TARGET_COLLISION")
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("native harness install rejects archive manifest permission drift despite a matching tuple digest", async () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "superskill-native-manifest-drift-"));
  try {
    const altered = YAML.parse(nativeManifestText);
    altered.permissions.network_allowlist = ["attacker.example"];
    const alteredText = YAML.stringify(altered);
    const alteredFiles = [nativeFiles[0]!, { path: "harness.yaml", content: alteredText, truncated: false }];
    const alteredDigest = canonicalArtifactDigest({ files: alteredFiles, totalFileCount: alteredFiles.length, archiveTruncated: false });
    await assert.rejects(
      () => installHostedCatalogSkill({
        registryUrl: registry,
        resourceId: nativeResourceId,
        version: nativeVersion,
        expectedDigest: alteredDigest,
        client: "codex",
        projectDir: project,
        fetchImpl: nativeFixtureFetch({ archiveManifestText: alteredText, tupleDigest: alteredDigest })
      }),
      hasReason("RESOURCE_ARCHIVE_INVALID")
    );
    assert.equal(readOptional(path.join(project, ".superskill/harnesses/deep-market-researcher")), undefined);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("catalog install preserves a pre-existing lock owned by another process", async () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "superskill-resource-lock-"));
  const lock = path.join(project, ".superskill-resource-install.lock");
  try {
    writeFileSync(lock, "other-owner", { mode: 0o600 });
    await assert.rejects(
      () => installHostedCatalogSkill({
        registryUrl: registry,
        resourceId: nativeResourceId,
        version: nativeVersion,
        expectedDigest: nativeDigest,
        client: "codex",
        projectDir: project,
        fetchImpl: nativeFixtureFetch()
      }),
      hasReason("INSTALL_FAILED")
    );
    assert.equal(readFileSync(lock, "utf8"), "other-owner");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("native harness install rolls back the first target when the second rename fails", async () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "superskill-native-rollback-"));
  let renames = 0;
  try {
    await assert.rejects(
      () => installHostedCatalogSkill({
        registryUrl: registry,
        resourceId: nativeResourceId,
        version: nativeVersion,
        expectedDigest: nativeDigest,
        client: "codex",
        projectDir: project,
        fetchImpl: nativeFixtureFetch(),
        renameImpl: (source, destination) => {
          renames += 1;
          if (renames === 2) throw new Error("injected second rename failure");
          renameSync(source, destination);
        }
      }),
      hasReason("INSTALL_FAILED")
    );
    assert.equal(renames, 2);
    assert.equal(readOptional(path.join(project, ".superskill/harnesses/deep-market-researcher")), undefined);
    assert.equal(readOptional(path.join(project, ".agents/skills/deep-market-researcher")), undefined);
    assert.equal(readOptional(path.join(project, ".superskill-resource-install.lock")), undefined);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

function fixtureFetch(actionUrl = archiveUrl, releaseOverride: Record<string, unknown> = {}, onRequest?: () => void): typeof fetch {
  return (async (input) => {
    onRequest?.();
    const url = String(input);
    if (url.includes("/resources/") && !url.endsWith("/archive")) {
      return new Response(JSON.stringify({
        id: resourceId,
        resourceType: "skill",
        installability: "importable",
        upstreamRepo: "clean-user-skill",
        trust: { securityScan: "not_scanned", riskTier: "UNKNOWN" },
        release: {
          version: "0.1.1",
          artifactDigest: createHash("sha256").update(archive).digest("hex"),
          archiveSize: archive.length,
          trust: "unreviewed",
          ...releaseOverride
        },
        actions: [{ id: "download_archive", url: actionUrl }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url === archiveUrl) {
      return new Response(archive, { status: 200, headers: {
        "content-type": "application/gzip",
        "x-onlyharness-resource-version": "0.1.1",
        "x-superskill-artifact-sha256": createHash("sha256").update(archive).digest("hex")
      } });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

type NativeFixtureOverrides = {
  resource?: Record<string, unknown>;
  detail?: { security?: Record<string, unknown>; nativeInstall?: Record<string, unknown> | null };
  archive?: Record<string, unknown>;
  archiveManifestText?: string;
  tupleDigest?: string;
  redirect?: boolean;
};

function nativeFixtureFetch(overrides: NativeFixtureOverrides = {}, requests: Array<{ url: string; init?: RequestInit }> = []): typeof fetch {
  const manifest = YAML.parse(nativeManifestText);
  const archiveFiles = overrides.archiveManifestText
    ? [nativeFiles[0]!, { path: "harness.yaml", content: overrides.archiveManifestText, truncated: false }]
    : nativeFiles;
  const tupleDigest = overrides.tupleDigest ?? canonicalArtifactDigest({ files: archiveFiles, totalFileCount: archiveFiles.length, archiveTruncated: false });
  const nativeInstall = overrides.detail?.nativeInstall === null ? null : {
    kind: "native_harness",
    resourceId: nativeResourceId,
    ref: "harnesses/deep-market-researcher",
    version: nativeVersion,
    artifactDigest: tupleDigest,
    snapshot: true,
    totalFileCount: archiveFiles.length,
    archiveTruncated: false,
    securityScan: "pass",
    scanner: "static-v2",
    scannedArtifactDigest: tupleDigest,
    riskTier: "MEDIUM",
    permissions: manifest.permissions,
    license: manifest.license,
    managedApproval: false,
    ...overrides.detail?.nativeInstall
  };
  return (async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (overrides.redirect) throw new TypeError("redirect blocked");
    if (url === `${registry}/resources/${encodeURIComponent(nativeResourceId)}`) {
      return new Response(JSON.stringify({
        id: nativeResourceId,
        resourceType: "harness",
        installability: "installable",
        upstreamId: "harnesses/deep-market-researcher",
        upstreamOwner: "harnesses",
        upstreamRepo: "deep-market-researcher",
        trust: { securityScan: "pass", riskTier: "MEDIUM" },
        actions: [{ id: "open_upstream", url: "https://superskill.sh/#/h/harnesses/deep-market-researcher" }],
        nativeInstall,
        ...overrides.resource
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url === `${registry}/repos/harnesses/deep-market-researcher/harness`) {
      return new Response(JSON.stringify({
        valid: true,
        manifest,
        security: { verdict: "pass", scanner: "static-v2", ...overrides.detail?.security },
        nativeInstall
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url === `${registry}/repos/harnesses/deep-market-researcher/archive?version=0.2.1`) {
      return new Response(JSON.stringify({
        owner: "harnesses",
        repo: "deep-market-researcher",
        version: nativeVersion,
        snapshot: true,
        artifactDigest: tupleDigest,
        totalFileCount: archiveFiles.length,
        archiveTruncated: false,
        files: archiveFiles,
        ...overrides.archive
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

function hasReason(reason: string) {
  return (error: unknown) => error instanceof SuperSkillCliError && error.reasonCode === reason;
}

function readOptional(file: string): string | undefined {
  try { return readFileSync(file, "utf8"); } catch { return undefined; }
}

function tarGz(files: Array<{ name: string; content: Buffer }>): Buffer {
  const blocks: Buffer[] = [];
  for (const file of files) {
    const header = Buffer.alloc(512);
    Buffer.from(file.name).copy(header, 0, 0, 100);
    writeOctal(header, 0o644, 100, 8);
    writeOctal(header, 0, 108, 8);
    writeOctal(header, 0, 116, 8);
    writeOctal(header, file.content.length, 124, 12);
    writeOctal(header, 0, 136, 12);
    header.fill(32, 148, 156);
    header[156] = 48;
    Buffer.from("ustar\0").copy(header, 257);
    Buffer.from("00").copy(header, 263);
    let sum = 0;
    for (const byte of header) sum += byte;
    const checksum = `${sum.toString(8).padStart(6, "0")}\0 `;
    Buffer.from(checksum).copy(header, 148);
    blocks.push(header, file.content);
    const padding = (512 - (file.content.length % 512)) % 512;
    if (padding) blocks.push(Buffer.alloc(padding));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

function writeOctal(target: Buffer, value: number, offset: number, length: number): void {
  const text = `${value.toString(8).padStart(length - 1, "0")}\0`;
  Buffer.from(text).copy(target, offset, 0, length);
}
