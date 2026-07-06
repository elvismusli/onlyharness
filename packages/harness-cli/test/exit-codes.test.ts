import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";

const HH = new URL("../dist/hh.mjs", import.meta.url).pathname;
const seedHarness = path.resolve(import.meta.dirname, "../../../seed-harnesses/deep-market-researcher");

let server: Server;
let registryUrl = "";
let sawPullToken = false;
let sawUpdateToken = false;

before(async () => {
  server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");

    if (request.url === "/healthz") {
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.url === "/registry") {
      response.end(JSON.stringify({ items: [{ owner: "harnesses", name: "deep-market-researcher" }] }));
      return;
    }

    if (request.url?.startsWith("/repos/harnesses/definitely-not-real-xyz/archive")) {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "Harness not found" }));
      return;
    }

    if (request.url?.startsWith("/repos/harnesses/paid-harness/archive")) {
      response.statusCode = 402;
      response.end(JSON.stringify({
        error: "Payment required",
        code: "PAYMENT_REQUIRED",
        checkout_url: "https://onlyharness.com/checkout?owner=harnesses&repo=paid-harness",
        pricing: { model: "one_time", amount_usd: 9, currency: "USD" }
      }));
      return;
    }

    if (request.url?.startsWith("/repos/harnesses/payments-disabled/archive")) {
      response.statusCode = 402;
      response.end(JSON.stringify({
        error: "Payment required",
        code: "PAYMENT_REQUIRED",
        checkout_url: "https://onlyharness.com/checkout?owner=harnesses&repo=payments-disabled",
        payments_enabled: false,
        next: "Payments are disabled in this environment.",
        pricing: { model: "one_time", amount_usd: 9, currency: "USD" }
      }));
      return;
    }

    if (request.url?.startsWith("/repos/harnesses/token-required/archive")) {
      sawPullToken = request.headers.authorization === "Bearer paid-token";
      response.end(JSON.stringify({
        owner: "harnesses",
        repo: "token-required",
        version: "0.1.0",
        files: [{ path: "README.md", truncated: false, content: "# token-required\n" }]
      }));
      return;
    }

    if (request.url?.startsWith("/repos/harnesses/deep-market-researcher/archive")) {
      sawUpdateToken = request.headers.authorization === "Bearer update-token";
      response.end(JSON.stringify({
        owner: "harnesses",
        repo: "deep-market-researcher",
        version: "0.2.0",
        files: [
          { path: "harness.yaml", truncated: false, content: updatedHarnessYaml() },
          { path: "README.md", truncated: false, content: "# Deep Market Researcher\n\nUpdated registry version.\n" },
          { path: "agents/web_researcher.md", truncated: false, content: "Updated researcher prompt.\n" },
          { path: "agents/synthesizer.md", truncated: false, content: "Updated synthesizer prompt.\n" },
          { path: "agents/critic.md", truncated: false, content: "Updated critic prompt.\n" },
          { path: "evals/promptfooconfig.yaml", truncated: false, content: "description: updated\nprompts: []\nproviders: []\n" },
          { path: "evals/cases/case-1.yaml", truncated: false, content: "title: Updated\nscore: 0.9\n" },
          { path: "examples/input.md", truncated: false, content: "updated input\n" },
          { path: "examples/expected.md", truncated: false, content: "updated expected\n" }
        ]
      }));
      return;
    }

    if (request.url?.startsWith("/repos/harnesses/deep-market-researcher/harness")) {
      response.end(JSON.stringify({
        owner: "harnesses",
        repo: "deep-market-researcher",
        manifest: { name: "deep-market-researcher", version: "0.2.0" }
      }));
      return;
    }

    if (request.url?.startsWith("/repos/harnesses/semver-harness/harness")) {
      response.end(JSON.stringify({
        owner: "harnesses",
        repo: "semver-harness",
        manifest: { name: "semver-harness", version: "0.10.0" }
      }));
      return;
    }

    if (request.url?.startsWith("/repos/harnesses/prerelease-harness/harness")) {
      response.end(JSON.stringify({
        owner: "harnesses",
        repo: "prerelease-harness",
        manifest: { name: "prerelease-harness", version: "0.2.0" }
      }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  registryUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test("pull of a missing harness exits 4 and names the next command", async () => {
  const result = await runCli(["pull", "harnesses/definitely-not-real-xyz"], { HH_REGISTRY_URL: registryUrl });

  assert.equal(result.status, 4);
  assert.match(result.stderr, /Next: hh search/);
});

test("pull of a paid harness exits 5 and returns JSON payment guidance", async () => {
  const result = await runCli(["pull", "harnesses/paid-harness", "--json"], { HH_REGISTRY_URL: registryUrl });

  assert.equal(result.status, 5);
  const body = JSON.parse(result.stderr) as { error?: string; code?: number; next?: string };
  assert.match(body.error ?? "", /Payment required/);
  assert.equal(body.code, 5);
  assert.match(body.next ?? "", /checkout/);
});

test("pull of a paid harness with disabled payments returns honest next step", async () => {
  const result = await runCli(["pull", "harnesses/payments-disabled", "--json"], { HH_REGISTRY_URL: registryUrl });

  assert.equal(result.status, 5);
  const body = JSON.parse(result.stderr) as { next?: string };
  assert.equal(body.next, "Payments are disabled in this environment.");
});

test("pull sends HH_TOKEN as a bearer token", async () => {
  sawPullToken = false;
  const out = await mkdtemp(path.join(os.tmpdir(), "hh-token-pull-"));
  try {
    const result = await runCli(["pull", "harnesses/token-required", "--out", out], { HH_REGISTRY_URL: registryUrl, HH_TOKEN: "paid-token" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(sawPullToken, true);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("pull writes source metadata for update flows", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "hh-source-pull-"));
  try {
    const result = await runCli(["pull", "harnesses/token-required", "--out", out], { HH_REGISTRY_URL: registryUrl });
    assert.equal(result.status, 0, result.stderr);
    const source = JSON.parse(await readFile(path.join(out, ".harnesshub/source.json"), "utf8")) as { owner?: string; name?: string; version?: string; registry?: string };
    assert.equal(source.owner, "harnesses");
    assert.equal(source.name, "token-required");
    assert.equal(source.version, "0.1.0");
    assert.equal(source.registry, registryUrl);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("doctor --harness reports local harness validity", async () => {
  const result = await runCli(["doctor", "--harness", seedHarness, "--json"], { HH_REGISTRY_URL: registryUrl });

  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout) as { harness?: { valid?: boolean; name?: string; version?: string; contextCost?: { approxTokens?: number; files?: number; status?: string } } };
  assert.equal(body.harness?.valid, true);
  assert.equal(body.harness?.name, "deep-market-researcher");
  assert.equal(body.harness?.version, "0.1.0");
  assert.equal(body.harness?.contextCost?.status, "estimated");
  assert.equal(typeof body.harness?.contextCost?.approxTokens, "number");
  assert.equal(typeof body.harness?.contextCost?.files, "number");
});

test("inspect --json includes local context cost", async () => {
  const result = await runCli(["inspect", seedHarness, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout) as { contextCost?: { approxTokens?: number; files?: number; status?: string } };
  assert.equal(body.contextCost?.status, "estimated");
  assert.equal(typeof body.contextCost?.approxTokens, "number");
  assert.equal(typeof body.contextCost?.files, "number");
});

test("pin writes pin metadata and outdated exits 3 for newer registry version", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "hh-outdated-"));
  try {
    await cp(seedHarness, out, { recursive: true });
    await mkdir(path.join(out, ".harnesshub"), { recursive: true });
    await writeFile(path.join(out, ".harnesshub/source.json"), JSON.stringify({
      owner: "harnesses",
      name: "deep-market-researcher",
      version: "0.1.0",
      registry: registryUrl,
      pulledAt: new Date().toISOString(),
      files: ["README.md", "obsolete.md"]
    }, null, 2));

    const pin = await runCli(["pin", out, "--json"], { HH_REGISTRY_URL: registryUrl });
    assert.equal(pin.status, 0, pin.stderr);
    const pinBody = JSON.parse(pin.stdout) as { owner?: string; name?: string; version?: string };
    assert.equal(pinBody.owner, "harnesses");
    assert.equal(pinBody.name, "deep-market-researcher");
    assert.equal(pinBody.version, "0.1.0");

    const outdated = await runCli(["outdated", out, "--json"], { HH_REGISTRY_URL: "http://127.0.0.1:1" });
    assert.equal(outdated.status, 3, outdated.stderr);
    const body = JSON.parse(outdated.stdout) as { outdated?: boolean; current?: string; latest?: string };
    assert.equal(body.outdated, true);
    assert.equal(body.current, "0.1.0");
    assert.equal(body.latest, "0.2.0");
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("update --diff previews without mutating files", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "hh-update-diff-"));
  try {
    await cp(seedHarness, out, { recursive: true });
    await mkdir(path.join(out, ".harnesshub"), { recursive: true });
    await writeFile(path.join(out, ".harnesshub/source.json"), JSON.stringify({
      owner: "harnesses",
      name: "deep-market-researcher",
      version: "0.1.0",
      registry: registryUrl,
      pulledAt: new Date().toISOString(),
      files: ["README.md"]
    }, null, 2));
    const before = await readFile(path.join(out, "README.md"), "utf8");
    const result = await runCli(["update", out, "--diff", "--json"], { HH_REGISTRY_URL: "http://127.0.0.1:1" });
    assert.equal(result.status, 0, result.stderr);
    const body = JSON.parse(result.stdout) as { diff?: { status?: string }; current?: string; latest?: string };
    assert.equal(body.current, "0.1.0");
    assert.equal(body.latest, "0.2.0");
    assert.equal(typeof body.diff?.status, "string");
    const after = await readFile(path.join(out, "README.md"), "utf8");
    assert.equal(after, before);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("update --force sends HH_TOKEN, updates metadata, and removes stale managed files", async () => {
  sawUpdateToken = false;
  const out = await mkdtemp(path.join(os.tmpdir(), "hh-update-force-"));
  try {
    await cp(seedHarness, out, { recursive: true });
    await mkdir(path.join(out, ".harnesshub"), { recursive: true });
    await writeFile(path.join(out, "obsolete.md"), "old managed file\n");
    await writeFile(path.join(out, ".harnesshub/source.json"), JSON.stringify({
      owner: "harnesses",
      name: "deep-market-researcher",
      version: "0.1.0",
      registry: registryUrl,
      pulledAt: new Date().toISOString(),
      files: ["README.md", "obsolete.md"]
    }, null, 2));

    const result = await runCli(["update", out, "--force", "--json"], { HH_REGISTRY_URL: "http://127.0.0.1:1", HH_TOKEN: "update-token" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(sawUpdateToken, true);
    const body = JSON.parse(result.stdout) as { previous?: string; version?: string };
    assert.equal(body.previous, "0.1.0");
    assert.equal(body.version, "0.2.0");
    const source = JSON.parse(await readFile(path.join(out, ".harnesshub/source.json"), "utf8")) as { version?: string; registry?: string; files?: string[] };
    assert.equal(source.version, "0.2.0");
    assert.equal(source.registry, registryUrl);
    assert.ok(source.files?.includes("README.md"));
    await assert.rejects(readFile(path.join(out, "obsolete.md"), "utf8"));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("outdated compares semver numerically and prerelease below stable", async () => {
  const semverDir = await mkdtemp(path.join(os.tmpdir(), "hh-semver-"));
  const prereleaseDir = await mkdtemp(path.join(os.tmpdir(), "hh-prerelease-"));
  try {
    await mkdir(path.join(semverDir, ".harnesshub"), { recursive: true });
    await writeFile(path.join(semverDir, ".harnesshub/source.json"), JSON.stringify({
      owner: "harnesses",
      name: "semver-harness",
      version: "0.2.0",
      registry: registryUrl,
      pulledAt: new Date().toISOString()
    }, null, 2));
    const semver = await runCli(["outdated", semverDir, "--json"], { HH_REGISTRY_URL: "http://127.0.0.1:1" });
    assert.equal(semver.status, 3, semver.stderr);
    assert.equal((JSON.parse(semver.stdout) as { latest?: string; outdated?: boolean }).latest, "0.10.0");

    await mkdir(path.join(prereleaseDir, ".harnesshub"), { recursive: true });
    await writeFile(path.join(prereleaseDir, ".harnesshub/source.json"), JSON.stringify({
      owner: "harnesses",
      name: "prerelease-harness",
      version: "0.2.0-beta.1",
      registry: registryUrl,
      pulledAt: new Date().toISOString()
    }, null, 2));
    const prerelease = await runCli(["outdated", prereleaseDir, "--json"], { HH_REGISTRY_URL: "http://127.0.0.1:1" });
    assert.equal(prerelease.status, 3, prerelease.stderr);
    assert.equal((JSON.parse(prerelease.stdout) as { latest?: string; outdated?: boolean }).outdated, true);
  } finally {
    await rm(semverDir, { recursive: true, force: true });
    await rm(prereleaseDir, { recursive: true, force: true });
  }
});

test("run outside a harness dir exits 4", async () => {
  const result = await runCli(["run", "/tmp"]);

  assert.equal(result.status, 4);
  assert.match(result.stderr, /hh pull/);
});

test("doctor --json returns machine readable status", async () => {
  const result = await runCli(["doctor", "--json"], { HH_REGISTRY_URL: registryUrl });

  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout) as { ok?: boolean; indexed?: number; registry?: string };
  assert.equal(body.ok, true);
  assert.equal(body.indexed, 1);
  assert.equal(body.registry, registryUrl);
});

test("audit-setup reports local skill conflicts, stale skills and a share card without absolute paths", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "hh-audit-home-"));
  const project = await mkdtemp(path.join(os.tmpdir(), "hh-audit-project-"));
  try {
    const homeSkill = path.join(home, ".claude/skills/research/SKILL.md");
    const projectSkill = path.join(project, ".claude/skills/research-copy/SKILL.md");
    await mkdir(path.dirname(homeSkill), { recursive: true });
    await mkdir(path.dirname(projectSkill), { recursive: true });
    await writeFile(homeSkill, [
      "---",
      "description: Use for market research competitor analysis and synthesis workflows.",
      "---",
      "# Research",
      "Collect market facts and synthesize a decision memo."
    ].join("\n"));
    await writeFile(path.join(path.dirname(homeSkill), "reference.md"), "Longer market research notes for context.\n");
    await writeFile(projectSkill, [
      "---",
      "description: Use for market research competitor analysis and buyer synthesis.",
      "---",
      "# Research Copy",
      "Overlapping trigger on purpose."
    ].join("\n"));
    const oldDate = new Date(Date.now() - 130 * 86_400_000);
    await utimes(homeSkill, oldDate, oldDate);
    await utimes(path.join(path.dirname(homeSkill), "reference.md"), oldDate, oldDate);

    const result = await runCli(["audit-setup", "--home-dir", home, "--project-dir", project, "--stale-days", "90", "--json"]);

    assert.equal(result.status, 0, result.stderr);
    const body = JSON.parse(result.stdout) as {
      summary?: { skills?: number; conflicts?: number; staleSkills?: number; approxTokens?: number };
      conflicts?: unknown[];
      stale?: unknown[];
      shareCard?: string;
      recommendations?: string[];
    };
    assert.equal(body.summary?.skills, 2);
    assert.equal(body.summary?.conflicts, 1);
    assert.equal(body.summary?.staleSkills, 1);
    assert.ok((body.summary?.approxTokens ?? 0) > 0);
    assert.equal(body.conflicts?.length, 1);
    assert.equal(body.stale?.length, 1);
    assert.match(body.shareCard ?? "", /OnlyHarness setup audit/);
    assert.doesNotMatch(body.shareCard ?? "", new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.ok(body.recommendations?.some((item) => /overlapping/i.test(item)));
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
  }
});

test("extract creates a valid harness with inferred depends_on and redacted source markdown", async () => {
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "hh-extract-source-"));
  const out = await mkdtemp(path.join(os.tmpdir(), "hh-extract-out-"));
  await rm(out, { recursive: true, force: true });
  try {
    const baseSkill = path.join(sourceRoot, ".claude/skills/base-helper/SKILL.md");
    const mainSkillDir = path.join(sourceRoot, ".claude/skills/sales-research");
    const mainSkill = path.join(mainSkillDir, "SKILL.md");
    await mkdir(path.dirname(baseSkill), { recursive: true });
    await mkdir(mainSkillDir, { recursive: true });
    await writeFile(baseSkill, "---\ndescription: Base helper used by extracted skills.\n---\n# Base Helper\n");
    await writeFile(mainSkill, [
      "---",
      "description: Use for sales research workflow extraction and buyer synthesis.",
      "depends_on:",
      "  - org/acme-foundation@1.0.0",
      "---",
      "# Sales Research",
      "Load alongside base-helper when customer evidence is thin."
    ].join("\n"));
    await writeFile(path.join(mainSkillDir, "notes.md"), "token=abcdefghijklmnopqrstuvwxyz\nUse private notes carefully.\n");

    const dryRun = await runCli(["extract", "sales-research", "--home-dir", sourceRoot, "--project-dir", sourceRoot, "--out", out, "--dry-run", "--json"]);

    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.doesNotMatch(dryRun.stdout, new RegExp(sourceRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await assert.rejects(readFile(path.join(out, "harness.yaml"), "utf8"));

    const result = await runCli(["extract", mainSkillDir, "--out", out, "--json"]);

    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, new RegExp(sourceRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const body = JSON.parse(result.stdout) as { name?: string; markdownFiles?: number; depends_on?: Array<{ ref?: string; version?: string; optional?: boolean }> };
    assert.equal(body.name, "sales-research");
    assert.equal(body.markdownFiles, 2);
    assert.ok(body.depends_on?.some((dependency) => dependency.ref === "org/acme-foundation" && dependency.version === "1.0.0" && dependency.optional === false));
    assert.ok(body.depends_on?.some((dependency) => dependency.ref === "skill:base-helper" && dependency.optional === true));

    const manifest = YAML.parse(await readFile(path.join(out, "harness.yaml"), "utf8")) as {
      schemaVersion?: string;
      visibility?: string;
      depends_on?: Array<{ ref?: string; version?: string }>;
      compatibility?: { targets?: Array<{ id?: string }> };
    };
    assert.equal(manifest.schemaVersion, "harness.v0.2");
    assert.equal(manifest.visibility, "private");
    assert.ok(manifest.depends_on?.some((dependency) => dependency.ref === "skill:base-helper"));
    assert.ok(manifest.depends_on?.some((dependency) => dependency.ref === "org/acme-foundation" && dependency.version === "1.0.0"));
    assert.ok(manifest.compatibility?.targets?.some((target) => target.id === "claude-code"));
    const copiedNotes = await readFile(path.join(out, "runbooks/source/notes.md"), "utf8");
    assert.match(copiedNotes, /token=REDACTED/);
    const readme = await readFile(path.join(out, "README.md"), "utf8");
    assert.doesNotMatch(readme, new RegExp(sourceRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const validate = await runCli(["validate", out, "--strict", "--json"]);
    assert.equal(validate.status, 0, validate.stderr);

    const duplicate = await runCli(["extract", mainSkillDir, "--out", out, "--json"]);
    assert.equal(duplicate.status, 3);
    const duplicateBody = JSON.parse(duplicate.stderr) as { error?: string };
    assert.match(duplicateBody.error ?? "", /not empty/);
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  }
});

test("extract by skill name refuses ambiguous home and project matches without writing", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "hh-extract-home-"));
  const project = await mkdtemp(path.join(os.tmpdir(), "hh-extract-project-"));
  const out = await mkdtemp(path.join(os.tmpdir(), "hh-extract-ambiguous-out-"));
  await rm(out, { recursive: true, force: true });
  try {
    const homeSkill = path.join(home, ".claude/skills/dupe/SKILL.md");
    const projectSkill = path.join(project, ".claude/skills/dupe/SKILL.md");
    await mkdir(path.dirname(homeSkill), { recursive: true });
    await mkdir(path.dirname(projectSkill), { recursive: true });
    await writeFile(homeSkill, "---\ndescription: Home duplicate skill.\n---\n# Dupe\n");
    await writeFile(projectSkill, "---\ndescription: Project duplicate skill.\n---\n# Dupe\n");

    const result = await runCli(["extract", "dupe", "--home-dir", home, "--project-dir", project, "--out", out, "--json"]);

    assert.equal(result.status, 3);
    const body = JSON.parse(result.stderr) as { error?: string; next?: string };
    assert.match(body.error ?? "", /ambiguous/);
    assert.match(body.next ?? "", /Candidates/);
    await assert.rejects(readFile(path.join(out, "harness.yaml"), "utf8"));
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  }
});

test("run --json exposes eval status for a pulled harness", async () => {
  const result = await runCli(["run", seedHarness, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout) as { eval?: { status?: string; score?: number } };
  assert.equal(body.eval?.status, "passed");
  assert.equal(typeof body.eval?.score, "number");
});

function runCli(args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [HH, ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`hh ${args.join(" ")} timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 10_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ status, stdout, stderr });
    });
  });
}

function updatedHarnessYaml(): string {
  return `schemaVersion: harness.v0.1
name: deep-market-researcher
title: Deep Market Researcher
summary: Multi-stage research, synthesis, critique and validation pipeline for market questions.
version: 0.2.0
license: MIT
tags: [research, strategy, validation]
runtime:
  primary: openai-agents-sdk
  adapters: []
agents:
  - id: web_researcher
    role: research
    prompt: agents/web_researcher.md
    tools: []
    handoffs: []
  - id: synthesizer
    role: synthesis
    prompt: agents/synthesizer.md
    tools: []
    handoffs: []
  - id: critic
    role: critique
    prompt: agents/critic.md
    tools: []
    handoffs: []
workflow:
  entrypoint: web_researcher
  stages:
    - id: research
      agent: web_researcher
tools:
  mcp_servers: []
  function_tools: []
  external_apis: []
permissions:
  network: allowlist
  network_allowlist: [api.openai.com]
  filesystem: readonly
  shell: false
  browser: false
  credentials: runtime_injected
  external_send: false
  money_movement: false
  user_data: false
  human_approval_required: []
evals:
  promptfoo_config: evals/promptfooconfig.yaml
  command: npx promptfoo@latest eval -c evals/promptfooconfig.yaml
quality_gates:
  min_score: 0.82
  max_regression: 0.03
  max_cost_usd_per_run: 3
  max_risk_score: 39
  required_checks: [schema_valid, eval_passed]
examples:
  - title: Updated
    input: examples/input.md
    output: examples/expected.md
`;
}
