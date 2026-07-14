import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { harnessManifestSchema } from "@harnesshub/schema";
import { ArchiveSnapshotConflictError, buildArchive, buildArchiveForVersion, listArchiveVersions, registryItemFromDir, versionRoot, writeArchiveSnapshot } from "../src/registry.ts";

test("registryItemFromDir exposes link-only directory metadata", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "hh-directory-"));
  try {
    writeDirectoryFixture(root, {
      name: "agent-directory",
      title: "Agent Directory",
      url: "https://example.com/agents",
      itemCount: 42,
      category: "catalog"
    });

    const item = registryItemFromDir("directories", root, new Map());
    assert.ok(item);
    assert.equal(item.owner, "directories");
    assert.equal(item.ownerLabel, "directory shelf");
    assert.equal(item.job, "Directory discovery");
    assert.equal(item.outcome, "Directory discovery");
    assert.equal(item.contentType, "directory");
    assert.deepEqual(item.directory, {
      url: "https://example.com/agents",
      itemCount: 42,
      category: "catalog",
      notes: "Link-only test directory."
    });
    assert.equal(item.forgeUrl, "https://example.com/agents");
    assert.equal(item.cliCommand, "open https://example.com/agents");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("registryItemFromDir exposes exact-install discovery without a legacy unbound command", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "hh-runnable-"));
  try {
    writeHarnessFixture(root, {
      name: "agent-runner",
      title: "Agent Runner"
    });

    const item = registryItemFromDir("harnesses", root, new Map());
    assert.ok(item);
    assert.equal(item.contentType, "harness");
    assert.match(item.cliCommand, /resource_detail.*pull_instructions.*exact harnesses\/agent-runner/);
    assert.doesNotMatch(JSON.stringify(item), /hh install/);
    assert.equal(item.job, "Harness building");
    assert.equal(item.signalCount, 0);
    assert.equal(item.heatQualified, false);
    assert.equal(item.freshness, "collecting signals");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("public archive construction ignores symlinks instead of following server files", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "hh-archive-symlink-"));
  const outside = path.join(root, "..", `hh-secret-${process.pid}-${Date.now()}`);
  try {
    writeFileSync(path.join(root, "README.md"), "# Public\n");
    writeFileSync(outside, "server-secret");
    symlinkSync(outside, path.join(root, "secret-link"));
    const archive = buildArchive(root);
    assert.deepEqual(archive.files.map((file) => file.path), ["README.md"]);
    assert.doesNotMatch(JSON.stringify(archive), /server-secret/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { force: true });
  }
});

test("listArchiveVersions exposes current manifest plus immutable snapshots", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "hh-versions-"));
  const owner = `test-${process.pid}`;
  const repo = `agent-runner-${Date.now()}`;
  try {
    writeHarnessFixture(root, {
      name: repo,
      title: "Agent Runner",
      version: "0.1.0"
    });
    const first = writeArchiveSnapshot(owner, repo, root);
    assert.equal(first?.version, "0.1.0");

    writeHarnessFixture(root, {
      name: repo,
      title: "Agent Runner",
      version: "0.2.0"
    });

    const versions = listArchiveVersions(owner, repo, root);
    assert.deepEqual(versions.map((entry) => ({
      version: entry.version,
      current: entry.current,
      snapshot: entry.snapshot
    })), [
      { version: "0.2.0", current: true, snapshot: false },
      { version: "0.1.0", current: false, snapshot: true }
    ]);
    assert.ok(versions.every((entry) => entry.fileCount > 0));

    const oldArchive = buildArchiveForVersion(owner, repo, root, "0.1.0");
    assert.equal(oldArchive?.version, "0.1.0");
    assert.equal(oldArchive?.snapshot, true);
    assert.match(oldArchive?.files.find((file) => file.path === "harness.yaml")?.content ?? "", /version: 0\.1\.0/);

    writeHarnessFixture(root, {
      name: repo,
      title: "Agent Runner",
      version: "0.1.0"
    });
    writeFileSync(path.join(root, "README.md"), "# Mutated same version\n");
    assert.throws(() => writeArchiveSnapshot(owner, repo, root), ArchiveSnapshotConflictError);
    const preservedArchive = buildArchiveForVersion(owner, repo, root, "0.1.0");
    assert.doesNotMatch(preservedArchive?.files.find((file) => file.path === "README.md")?.content ?? "", /Mutated/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(path.join(versionRoot, owner), { recursive: true, force: true });
  }
});

test("directory manifests must stay free, v0.2 and link-only", () => {
  const valid = directoryManifest({
    name: "valid-directory",
    title: "Valid Directory",
    url: "https://example.com/valid",
    itemCount: 1,
    category: "catalog"
  });
  assert.equal(harnessManifestSchema.safeParse(valid).success, true);

  const unsafe = {
    ...valid,
    schemaVersion: "harness.v0.1",
    pricing: { model: "one_time", amount_usd: 9, currency: "USD" },
    source: { ...valid.source, vendor_policy: "original" },
    content: { type: "directory", directory: { category: "catalog" } },
    permissions: { ...valid.permissions, money_movement: true }
  };
  const parsed = harnessManifestSchema.safeParse(unsafe);
  assert.equal(parsed.success, false);
  const messages = parsed.error.issues.map((issue) => issue.message);
  assert.ok(messages.includes("directory content requires schemaVersion harness.v0.2"));
  assert.ok(messages.includes("directory content requires a link-only url"));
  assert.ok(messages.includes("directory content must use source.vendor_policy link-only"));
  assert.ok(messages.includes("directory content must be free link-only discovery"));
  assert.ok(messages.includes("directory content cannot request external_send or money_movement"));
});

function writeDirectoryFixture(root: string, input: { name: string; title: string; url: string; itemCount: number; category: string }) {
  for (const dir of ["agents", "evals/cases", "examples"]) mkdirSync(path.join(root, dir), { recursive: true });
  writeFileSync(path.join(root, "harness.yaml"), YAML.stringify(directoryManifest(input)));
  writeFileSync(path.join(root, "README.md"), "# Directory\n");
  writeFileSync(path.join(root, "agents/curator.md"), "# Curator\n");
  writeFileSync(path.join(root, "evals/promptfooconfig.yaml"), "description: directory\nprompts: []\nproviders: []\n");
  writeFileSync(path.join(root, "evals/cases/smoke.yaml"), "title: Smoke\nscore: 0.9\n");
  writeFileSync(path.join(root, "examples/input.md"), "input\n");
  writeFileSync(path.join(root, "examples/expected.md"), "expected\n");
}

function writeHarnessFixture(root: string, input: { name: string; title: string; version?: string }) {
  for (const dir of ["agents", "evals/cases", "examples"]) mkdirSync(path.join(root, dir), { recursive: true });
  writeFileSync(path.join(root, "harness.yaml"), YAML.stringify(harnessManifest(input)));
  writeFileSync(path.join(root, "README.md"), "# Harness\n");
  writeFileSync(path.join(root, "agents/operator.md"), "# Operator\n");
  writeFileSync(path.join(root, "evals/promptfooconfig.yaml"), "description: harness\nprompts: []\nproviders: []\n");
  writeFileSync(path.join(root, "evals/cases/smoke.yaml"), "title: Smoke\nscore: 0.9\n");
  writeFileSync(path.join(root, "examples/input.md"), "input\n");
  writeFileSync(path.join(root, "examples/expected.md"), "expected\n");
}

function directoryManifest(input: { name: string; title: string; url: string; itemCount: number; category: string }) {
  return {
    schemaVersion: "harness.v0.2",
    name: input.name,
    title: input.title,
    summary: "Link-only directory test fixture for agent resources.",
    version: "0.1.0",
    license: "UNSPECIFIED",
    content: {
      type: "directory",
      directory: {
        url: input.url,
        item_count: input.itemCount,
        category: input.category,
        notes: "Link-only test directory."
      }
    },
    source: {
      upstream_url: input.url,
      upstream_license: "UNSPECIFIED",
      attribution: "Test fixture",
      vendor_policy: "link-only"
    },
    tags: ["directory", "catalog"],
    runtime: { primary: "none", adapters: [] },
    agents: [{ id: "curator", role: "directory_curator", prompt: "agents/curator.md", tools: [], handoffs: [] }],
    workflow: { entrypoint: "curator", stages: [{ id: "inspect", agent: "curator" }] },
    tools: { mcp_servers: [], function_tools: [], external_apis: [] },
    permissions: {
      network: "false",
      network_allowlist: [],
      filesystem: "readonly",
      shell: false,
      browser: false,
      credentials: "false",
      external_send: false,
      money_movement: false,
      user_data: false,
      human_approval_required: []
    },
    evals: {
      promptfoo_config: "evals/promptfooconfig.yaml",
      command: "npx promptfoo@latest eval -c evals/promptfooconfig.yaml"
    },
    quality_gates: {
      min_score: 0.8,
      max_regression: 0.03,
      max_cost_usd_per_run: 1,
      max_risk_score: 39,
      required_checks: ["schema_valid"]
    },
    examples: [{ title: "Directory lookup", input: "examples/input.md", output: "examples/expected.md" }]
  };
}

function harnessManifest(input: { name: string; title: string; version?: string }) {
  return {
    schemaVersion: "harness.v0.2",
    name: input.name,
    title: input.title,
    summary: "Runnable harness test fixture.",
    version: input.version ?? "0.1.0",
    license: "MIT",
    source: {
      upstream_url: "https://example.com/agent-runner",
      upstream_license: "MIT",
      attribution: "Test fixture",
      vendor_policy: "original"
    },
    tags: ["test"],
    runtime: { primary: "custom", adapters: [] },
    agents: [{ id: "operator", role: "operator", prompt: "agents/operator.md", tools: [], handoffs: [] }],
    workflow: { entrypoint: "operator", stages: [{ id: "run", agent: "operator" }] },
    tools: { mcp_servers: [], function_tools: [], external_apis: [] },
    permissions: {
      network: "false",
      network_allowlist: [],
      filesystem: "readonly",
      shell: false,
      browser: false,
      credentials: "false",
      external_send: false,
      money_movement: false,
      user_data: false,
      human_approval_required: []
    },
    evals: {
      promptfoo_config: "evals/promptfooconfig.yaml",
      command: "npx promptfoo@latest eval -c evals/promptfooconfig.yaml"
    },
    quality_gates: {
      min_score: 0.8,
      max_regression: 0.03,
      max_cost_usd_per_run: 1,
      max_risk_score: 39,
      required_checks: ["schema_valid"]
    },
    examples: [{ title: "Smoke", input: "examples/input.md", output: "examples/expected.md" }]
  };
}
