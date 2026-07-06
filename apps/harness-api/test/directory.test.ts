import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { harnessManifestSchema } from "@harnesshub/schema";
import { registryItemFromDir } from "../src/registry.ts";

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
    assert.equal(item.outcome, "Directories");
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
