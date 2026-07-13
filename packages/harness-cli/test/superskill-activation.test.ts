import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, unlinkSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalArtifactDigest } from "@harnesshub/capability-schema/node";
import { activationRecordSchema, type ManagedCapability } from "@harnesshub/capability-schema/browser";
import {
  finishActivation,
  keepActivation,
  markActivation,
  removeActivation,
  startActivation
} from "../src/commands/activation.js";
import { readActivation, resolveProjectState, writeActivation, writeRemovalIntent } from "../src/lib/activation-store.js";
import { computeDecisionDigest } from "../src/lib/superskill-client.js";
import { readPinnedMarker } from "../src/lib/client-adapters.js";
import { SuperSkillCliError } from "../src/lib/superskill-types.js";

const seed = path.resolve(import.meta.dirname, "../../../seed-harnesses/deep-market-researcher");
const files = collectFiles(seed);
const artifactDigest = canonicalArtifactDigest(files);
const seedVersion = readFileSync(path.join(seed, "harness.yaml"), "utf8").match(/^version:\s*(\S+)\s*$/m)?.[1];
if (!seedVersion) throw new Error("Deep Market Researcher fixture version missing");
const expiresAt = "2099-01-01T00:00:00.000Z";
const capability: ManagedCapability = {
  id: "market-research",
  type: "instruction_harness",
  title: "Deep Market Researcher",
  summary: "Reviewed multi-stage market research workflow.",
  jobs: [{ id: "market-research", intents: ["market research"], outcomes: ["source-backed comparison"], exclusions: ["send outreach"] }],
  release: { ref: "harnesses/deep-market-researcher", version: seedVersion, artifactDigest, immutable: true, publishedAt: "2026-07-01T00:00:00.000Z", delivery: "free_archive" },
  source: { owner: "OnlyHarness", url: "https://onlyharness.com", license: "MIT" },
  compatibility: [
    { client: "claude-code", status: "verified", verifiedAt: "2026-07-01T00:00:00.000Z" },
    { client: "codex", status: "verified", verifiedAt: "2026-07-01T00:00:00.000Z" }
  ],
  permissions: {
    network: "allowlist",
    networkAllowlist: ["example.com"],
    filesystem: "readonly",
    shell: false,
    browser: true,
    credentials: "false",
    externalSend: false,
    moneyMovement: false,
    userData: false,
    humanApprovalRequired: []
  },
  contextCost: { approxTokens: 1000, files: files.length, bytes: files.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0), status: "estimated" },
  trust: {
    status: "approved",
    riskScore: 12,
    riskTier: "LOW",
    checks: [{ id: "artifact_digest", status: "pass", evidenceLevel: "static_checked", checkedAt: "2026-07-01T00:00:00.000Z", summary: "Exact digest matched." }],
    limitations: ["Public web sources may be incomplete."],
    reviewedAt: "2026-07-01T00:00:00.000Z"
  }
};

let server: Server;
let registry = "";
const requestBodies: string[] = [];
const authHeaders: Array<string | undefined> = [];

before(async () => {
  server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    authHeaders.push(request.headers.authorization);
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      if (raw) requestBodies.push(raw);
      if (request.headers.authorization !== "Bearer fixture-secret-token") {
        response.statusCode = 403;
        response.end(JSON.stringify({ error: "denied", code: "INTERNAL_ALPHA_DENIED" }));
        return;
      }
      if (request.url === "/recommendations" && request.method === "POST") {
        const input = JSON.parse(raw) as { task: string; context: { client: "claude-code" | "codex" } };
        if (input.task.includes("no match")) {
          response.end(JSON.stringify({ recommendationId: "rec_nomatch1234", decisionDigest: `sha256:${"0".repeat(64)}`, decision: "no_safe_match", confidence: 0, alternatives: [], expiresAt }));
          return;
        }
        response.end(JSON.stringify({
          recommendationId: "rec_abcdefgh1234",
          decisionDigest: computeDecisionDigest(capability, input.context.client, expiresAt),
          decision: "recommend",
          confidence: 0.9,
          selected: {
            capability,
            score: 90,
            why: [{ code: "INTENT_EXACT", text: "Exact market-research intent match.", points: 40 }],
            limitations: capability.trust.limitations,
            permissionDelta: { status: "partial", added: ["browser"], unchanged: [], unknownBecause: "Unmanaged client policy is not known." },
            consent: "required"
          },
          alternatives: [],
          expiresAt
        }));
        return;
      }
      if (request.url === `/capabilities/market-research/releases/${seedVersion}`) {
        response.end(JSON.stringify({ capability, activationAllowed: true, archive: { url: `${registry}/capabilities/market-research/releases/${seedVersion}/archive`, artifactDigest } }));
        return;
      }
      if (request.url === `/capabilities/market-research/releases/${seedVersion}/archive`) {
        response.end(JSON.stringify({ owner: "harnesses", repo: "deep-market-researcher", version: seedVersion, snapshot: true, artifactDigest, totalFileCount: files.length, archiveTruncated: false, files }));
        return;
      }
      if (request.url === "/events") {
        response.end(JSON.stringify({ recorded: true, duplicate: false }));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not found", code: "CAPABILITY_NOT_FOUND" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  registry = `http://127.0.0.1:${address.port}`;
  process.env.HH_SUPERSKILL_TOKEN = "fixture-secret-token";
  process.env.HH_SUPERSKILL_DOCTOR_SKIP_NPM_VIEW = "1";
});

after(async () => {
  delete process.env.HH_SUPERSKILL_TOKEN;
  delete process.env.HH_SUPERSKILL_DOCTOR_SKIP_NPM_VIEW;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

for (const client of ["claude-code", "codex"] as const) {
  test(`transactional activation lifecycle, adoption and safe removal: ${client}`, async () => {
    const project = mkdtempSync(path.join(os.tmpdir(), `superskill-${client}-`));
    try {
      execFileSync("git", ["init", "-q"], { cwd: project });
      const decisionDigest = computeDecisionDigest(capability, client, expiresAt);
      const requestId = `req_${client.replace("-", "")}_abcdefgh`;
      const input = {
        registry,
        projectDir: project,
        capabilityId: capability.id,
        version: capability.release.version,
        digest: capability.release.artifactDigest,
        recommendationId: "rec_abcdefgh1234",
        decisionDigest,
        recommendationExpiresAt: expiresAt,
        activationRequestId: requestId,
        client,
        mode: "temporary",
        consent: "explicit"
      };
      const started = await startActivation(input) as { activationId: string; executionState: string; plan: { root: string } };
      assert.equal(started.executionState, "ready");
      const state = resolveProjectState(project);
      assert.ok(started.plan.root.startsWith(path.join(state.projectRoot, ".onlyharness", "cache")), `${started.plan.root} is not below ${state.projectRoot}`);
      assert.equal(existsNativePin(project, client), false, "temporary activation must not write a native pin");
      assert.match(readFileSync(path.join(project, ".git", "info", "exclude"), "utf8"), /^\.onlyharness\/$/m);

      // A persisted process-crash state resumes only for the identical request tuple.
      const crashed = readActivation(state, started.activationId);
      crashed.executionState = "downloading";
      writeActivation(state, crashed);
      const resumed = await startActivation(input) as { activationId: string; executionState: string };
      assert.equal(resumed.activationId, started.activationId);
      assert.equal(resumed.executionState, "ready");

      await markActivation(registry, project, started.activationId, "loaded");
      await markActivation(registry, project, started.activationId, "loaded");
      await markActivation(registry, project, started.activationId, "invoked");
      const finished = await finishActivation(registry, project, started.activationId, "success", "agent_reported");
      assert.equal(finished.executionState, "outcome_success");
      const upgraded = await finishActivation(registry, project, started.activationId, "success", "user_confirmed");
      assert.equal(upgraded.outcome.evidence, "user_confirmed");
      await assert.rejects(() => finishActivation(registry, project, started.activationId, "failed", "agent_reported"), hasReason("ACTIVATION_INVALID_TRANSITION"));

      const kept = await keepActivation(registry, project, started.activationId, true);
      assert.equal(kept.pinState, "pinned");
      const markerRelative = client === "codex" ? ".agents/skills/superskill-market-research/.superskill-managed.json" : ".claude/skills/superskill-market-research/.superskill-managed.json";
      const markerFile = path.join(project, markerRelative);
      assert.ok(statSync(markerFile).isFile());
      assert.equal(existsNativePin(project, client === "codex" ? "claude-code" : "codex"), false);
      assert.equal(existsSyncCompat(path.join(project, ".codex", "harnesses")), false);

      // Simulate crash after atomic pin rename and before activation record update; retry adopts exact owned files.
      const beforeAdopt = readActivation(state, started.activationId);
      beforeAdopt.pinState = "none";
      delete beforeAdopt.pinned;
      writeActivation(state, beforeAdopt);
      const adopted = await keepActivation(registry, project, started.activationId, true);
      assert.equal(adopted.pinState, "pinned");

      const pinnedUse = await startActivation({ registry, projectDir: project, activationRequestId: `req_pinned${client.replace("-", "")}xyz`, client, mode: "pinned", consent: "explicit", fromPinned: markerRelative });
      assert.equal(pinnedUse.executionState, "ready");

      const originalSkill = readFileSync(path.join(path.dirname(markerFile), "SKILL.md"), "utf8");
      writeFileSync(path.join(path.dirname(markerFile), "SKILL.md"), `${originalSkill}\nchanged\n`);
      await assert.rejects(() => removeActivation(project, markerRelative, true), hasReason("MANAGED_FILE_CHANGED"));
      assert.ok(statSync(markerFile).isFile(), "changed-file preflight must preserve marker and every remaining file");
      writeFileSync(path.join(path.dirname(markerFile), "SKILL.md"), originalSkill);

      // Simulate crash after all owned files and marker are deleted, but before record pinState update.
      const marker = readPinnedMarker(markerFile)!;
      const owner = readActivation(state, started.activationId);
      writeRemovalIntent(state, { markerPath: markerRelative, activationId: owner.activationId });
      for (const relative of Object.keys(marker.managedFiles).sort((a, b) => b.length - a.length)) {
        const file = path.join(path.dirname(markerFile), relative);
        if (existsSyncCompat(file)) unlinkSync(file);
      }
      unlinkSync(markerFile);
      const removed = await removeActivation(project, markerRelative, true);
      assert.equal(removed.pinState, "removed");
      assert.equal(removed.alreadyRemoved, true);
      assert.equal(readActivation(state, started.activationId).pinState, "removed");
      for (const record of readdirSync(path.join(state.stateRoot, "activations")).filter((name) => name.endsWith(".json"))) {
        assert.equal(activationRecordSchema.safeParse(JSON.parse(readFileSync(path.join(state.stateRoot, "activations", record), "utf8"))).success, true, `${record} must match shared strict activation schema`);
      }
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
}

test("token remains in Authorization only and never enters event or project state", () => {
  assert.ok(authHeaders.length > 0 && authHeaders.every((header) => header === "Bearer fixture-secret-token"));
  assert.ok(requestBodies.every((body) => !body.includes("fixture-secret-token")));
});

test("recommend CLI preserves managed JSON/exit contracts and validates secrets before network", async () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "superskill-recommend-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: project });
    const ok = await runCli(["recommend", "market", "research", "--target", "codex", "--project-dir", project, "--json"]);
    assert.equal(ok.code, 0, ok.stderr);
    const body = JSON.parse(ok.stdout) as { decision: string; client: string; next: string[] };
    assert.equal(body.decision, "recommend");
    assert.equal(body.client, "codex");
    assert.match(body.next[0]!, /--target codex --mode temporary --consent explicit/);

    const noMatch = await runCli(["recommend", "no", "match", "please", "--target", "claude-code", "--project-dir", project, "--json"]);
    assert.equal(noMatch.code, 3);
    assert.equal(JSON.parse(noMatch.stdout).decision, "no_safe_match");

    const before = requestBodies.length;
    const secret = await runCli(["recommend", "token=abcdefghijklmnopqrstuvwxyz", "--target", "codex", "--project-dir", project, "--json"]);
    assert.equal(secret.code, 3);
    assert.equal(JSON.parse(secret.stderr).reasonCode, "TASK_INVALID");
    assert.equal(requestBodies.length, before, "secret-like task must be rejected before network");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("concurrent starts use one verified cache without corrupting either activation", async () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "superskill-concurrent-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: project });
    const base = {
      registry,
      projectDir: project,
      capabilityId: capability.id,
      version: capability.release.version,
      digest: capability.release.artifactDigest,
      recommendationId: "rec_abcdefgh1234",
      decisionDigest: computeDecisionDigest(capability, "codex" as const, expiresAt),
      recommendationExpiresAt: expiresAt,
      client: "codex" as const,
      mode: "temporary",
      consent: "explicit"
    };
    const [first, second] = await Promise.all([
      startActivation({ ...base, activationRequestId: "req_concurrent_one" }),
      startActivation({ ...base, activationRequestId: "req_concurrent_two" })
    ]) as Array<{ activationId: string; executionState: string; plan: { root: string } }>;
    assert.notEqual(first.activationId, second.activationId);
    assert.equal(first.executionState, "ready");
    assert.equal(second.executionState, "ready");
    assert.equal(first.plan.root, second.plan.root);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

for (const client of ["claude-code", "codex"] as const) {
  test(`keep rejects symlinked native pinned root without writing outside: ${client}`, async () => {
    const project = mkdtempSync(path.join(os.tmpdir(), `superskill-pin-symlink-${client}-`));
    const outside = mkdtempSync(path.join(os.tmpdir(), `superskill-pin-outside-${client}-`));
    try {
      execFileSync("git", ["init", "-q"], { cwd: project });
      const input = {
        registry,
        projectDir: project,
        capabilityId: capability.id,
        version: capability.release.version,
        digest: capability.release.artifactDigest,
        recommendationId: "rec_abcdefgh1234",
        decisionDigest: computeDecisionDigest(capability, client, expiresAt),
        recommendationExpiresAt: expiresAt,
        activationRequestId: `req_symlink_${client.replace("-", "")}`,
        client,
        mode: "temporary",
        consent: "explicit"
      };
      const started = await startActivation(input) as { activationId: string };
      await markActivation(registry, project, started.activationId, "loaded");
      await markActivation(registry, project, started.activationId, "invoked");
      await finishActivation(registry, project, started.activationId, "success", "agent_reported");
      const nativeRoot = path.join(project, client === "codex" ? ".agents" : ".claude");
      symlinkSync(outside, nativeRoot, "dir");
      await assert.rejects(
        () => keepActivation(registry, project, started.activationId, true),
        (error: unknown) => error instanceof SuperSkillCliError && error.reasonCode === "MANAGED_FILE_CHANGED"
      );
      assert.deepEqual(readdirSync(outside), []);
      assert.equal(readActivation(resolveProjectState(project), started.activationId).pinState, "none");
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
}

function collectFiles(root: string): Array<{ path: string; content: string; truncated: false }> {
  const result: Array<{ path: string; content: string; truncated: false }> = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) result.push({ path: path.relative(root, file).split(path.sep).join("/"), content: readFileSync(file, "utf8"), truncated: false });
    }
  };
  visit(root);
  return result;
}

function existsNativePin(project: string, client: "claude-code" | "codex"): boolean {
  return existsSyncCompat(path.join(project, client === "codex" ? ".agents/skills/superskill-market-research" : ".claude/skills/superskill-market-research"));
}

function existsSyncCompat(file: string): boolean {
  try { statSync(file); return true; } catch { return false; }
}

function hasReason(reasonCode: string) {
  return (error: unknown) => error instanceof SuperSkillCliError && error.reasonCode === reasonCode;
}

async function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const hh = path.resolve(import.meta.dirname, "../dist/hh.mjs");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hh, ...args], {
      env: { ...process.env, HH_REGISTRY_URL: registry, HH_SUPERSKILL_TOKEN: "fixture-secret-token" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}
