import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installHostedCatalogSkill } from "../src/lib/resource-skill-install.js";
import { SuperSkillCliError } from "../src/lib/superskill-types.js";

const registry = "https://superskill.sh/api";
const resourceId = "onlyharness:packages/clean-user-skill";
const archiveUrl = `https://superskill.sh/api/resources/${encodeURIComponent(resourceId)}/releases/0.1.1/archive`;
const skill = `---\nname: clean-user-skill\ndescription: "Clean test skill"\n---\n\n# Clean user skill\n`;
const archive = tarGz([
  { name: "README.md", content: Buffer.from("# Clean user skill\n") },
  { name: "SKILL.md", content: Buffer.from(skill) }
]);

test("explicit unreviewed hosted skill install routes to Codex and is idempotent", async () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "superskill-resource-install-"));
  try {
    const fetchImpl = fixtureFetch();
    await assert.rejects(
      () => installHostedCatalogSkill({ registryUrl: registry, resourceId, client: "codex", projectDir: project, fetchImpl }),
      hasReason("RESOURCE_REVIEW_REQUIRED")
    );
    const installed = await installHostedCatalogSkill({
      registryUrl: registry,
      resourceId,
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

test("hosted skill install rejects cross-origin archives and symlinked native roots", async () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "superskill-resource-guards-"));
  const outside = mkdtempSync(path.join(os.tmpdir(), "superskill-resource-outside-"));
  try {
    await assert.rejects(
      () => installHostedCatalogSkill({
        registryUrl: registry,
        resourceId,
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

function fixtureFetch(actionUrl = archiveUrl): typeof fetch {
  return (async (input) => {
    const url = String(input);
    if (url.includes("/resources/") && !url.endsWith("/archive")) {
      return new Response(JSON.stringify({
        id: resourceId,
        resourceType: "skill",
        installability: "importable",
        upstreamRepo: "clean-user-skill",
        trust: { securityScan: "not_scanned", riskTier: "UNKNOWN" },
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
