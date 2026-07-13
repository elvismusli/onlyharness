import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ManagedCapability } from "@harnesshub/capability-schema/browser";
import { canonicalInstallUrl, type BootstrapCapability } from "../src/lib/superskill-bootstrap.js";
import { computeDecisionDigest } from "../src/lib/superskill-client.js";
import { consumePendingSuperSkillHandoff, readPendingSuperSkillHandoff } from "../src/lib/superskill-handoff.js";
import { SUPERSKILL_RUNTIME, SuperSkillCliError } from "../src/lib/superskill-types.js";

const expiresAt = "2099-01-01T00:00:00.000Z";
const tuple: BootstrapCapability = { id: "market-research", version: "0.2.0", artifactDigest: `sha256:${"a".repeat(64)}` };
const capability: ManagedCapability = {
  id: tuple.id,
  type: "instruction_harness",
  title: "Deep Market Researcher",
  summary: "Reviewed source-backed market research capability.",
  jobs: [{ id: "market-research", intents: ["market research"], outcomes: ["source-backed comparison"], exclusions: ["buy data"] }],
  release: { ref: "harnesses/deep-market-researcher", version: tuple.version, artifactDigest: tuple.artifactDigest, immutable: true, publishedAt: "2026-07-01T00:00:00.000Z", delivery: "free_archive" },
  source: { owner: "SuperSkill", url: "https://superskill.sh", license: "MIT" },
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
  contextCost: { approxTokens: 1000, files: 3, bytes: 6000, status: "estimated" },
  trust: {
    status: "approved",
    riskScore: 10,
    riskTier: "LOW",
    checks: [{ id: "artifact_digest", status: "pass", evidenceLevel: "static_checked", checkedAt: "2026-07-01T00:00:00.000Z", expiresAt, summary: "Exact digest passed" }],
    limitations: ["Sources still require user judgment"],
    reviewedAt: "2026-07-01T00:00:00.000Z"
  }
};

let server: Server;
let registry = "";
const observed: Array<{ authorization?: string; body: unknown }> = [];

before(async () => {
  server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      const body = JSON.parse(raw) as { capability: BootstrapCapability; client: "codex" | "claude-code" };
      observed.push({ authorization: request.headers.authorization, body });
      if (request.url !== "/superskill/handoff/decision" || request.method !== "POST" || request.headers.authorization !== "Bearer account-token") {
        response.statusCode = 403;
        response.end(JSON.stringify({ error: "denied", code: "SUPERSKILL_ACCESS_DENIED" }));
        return;
      }
      response.end(JSON.stringify({
        recommendationId: "rec_exacthandoff01",
        decisionDigest: computeDecisionDigest(capability, body.client, expiresAt, "rec_exacthandoff01"),
        decision: "recommend",
        confidence: 1,
        selected: {
          capability,
          score: 100,
          why: [{ code: "CLIENT_VERIFIED", text: "Exact client proof is current", points: 100 }],
          limitations: capability.trust.limitations,
          permissionDelta: { status: "partial", added: ["browser"], unchanged: [], unknownBecause: "Unmanaged client policy is unknown" },
          consent: "required"
        },
        alternatives: [],
        expiresAt
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  registry = `http://127.0.0.1:${address.port}`;
  process.env.HH_TOKEN = "account-token";
  process.env.HH_SUPERSKILL_TOKEN = "legacy-token-must-not-win";
  process.env.HH_SUPERSKILL_ALLOW_INSECURE_TEST_REGISTRY = "1";
});

after(async () => {
  delete process.env.HH_TOKEN;
  delete process.env.HH_SUPERSKILL_TOKEN;
  delete process.env.HH_SUPERSKILL_ALLOW_INSECURE_TEST_REGISTRY;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("pending exact handoff is disclosed online without activation and retries are read-only", async () => {
  const project = projectWithHandoff();
  try {
    const file = path.join(project, ".onlyharness/superskill-handoff.json");
    const before = readFileSync(file, "utf8");
    const first = await consumePendingSuperSkillHandoff({ registry, projectDir: project, client: "codex" });
    const second = await consumePendingSuperSkillHandoff({ registry, projectDir: project, client: "codex" });
    assert.equal(first.recommendation.selected?.capability.release.artifactDigest, tuple.artifactDigest);
    assert.deepEqual(first.recommendation.selected?.capability.permissions, capability.permissions);
    assert.deepEqual(first.recommendation.selected?.capability.trust.checks, capability.trust.checks);
    assert.ok(first.activation.command.startsWith(`npx --yes onlyharness@${SUPERSKILL_RUNTIME.cliVersion} activation start market-research `));
    assert.match(first.activation.command, /--target codex --mode temporary --consent explicit --json$/);
    assert.match(first.activation.command, /--activation-request req_[A-Za-z0-9_-]{8,}/);
    assert.equal(first.activation.command.includes("<"), false);
    assert.equal(first.activation.performed, false);
    assert.equal(second.activation.performed, false);
    assert.equal(first.activation.command, second.activation.command);
    assert.equal(readFileSync(file, "utf8"), before);
    assert.equal(existsSync(path.join(project, ".onlyharness/activations")), false);
    assert.equal(JSON.stringify(first).includes(project), false);
    assert.equal(JSON.stringify(first).includes("account-token"), false);
    assert.equal(observed.at(-1)?.authorization, "Bearer account-token");
    assert.deepEqual(observed.at(-1)?.body, { capability: tuple, client: "codex" });
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("malformed and symlink handoffs fail closed without leaking local paths", () => {
  const malformed = mkdtempSync(path.join(os.tmpdir(), "superskill-handoff-malformed-"));
  const outside = mkdtempSync(path.join(os.tmpdir(), "superskill-handoff-outside-"));
  try {
    mkdirSync(path.join(malformed, ".onlyharness"));
    const secretPath = `${malformed}/private-source`;
    writeFileSync(path.join(malformed, ".onlyharness/superskill-handoff.json"), JSON.stringify({
      schemaVersion: "superskill.handoff.v1",
      status: "pending_explicit_activation_consent",
      capability: tuple,
      canonicalUrl: canonicalInstallUrl(tuple),
      projectPath: secretPath
    }));
    assert.throws(() => readPendingSuperSkillHandoff(malformed), errorWithoutPath("HANDOFF_INVALID", secretPath));

    rmSync(path.join(malformed, ".onlyharness/superskill-handoff.json"));
    const outsideFile = path.join(outside, "secret.json");
    writeFileSync(outsideFile, JSON.stringify({ secret: "must-not-read" }));
    symlinkSync(outsideFile, path.join(malformed, ".onlyharness/superskill-handoff.json"));
    assert.throws(() => readPendingSuperSkillHandoff(malformed), errorWithoutPath("HANDOFF_UNSAFE", outsideFile));
  } finally {
    rmSync(malformed, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

function projectWithHandoff(): string {
  const project = mkdtempSync(path.join(os.tmpdir(), "superskill-handoff-consumer-"));
  mkdirSync(path.join(project, ".onlyharness"));
  writeFileSync(path.join(project, ".onlyharness/superskill-handoff.json"), `${JSON.stringify({
    schemaVersion: "superskill.handoff.v1",
    status: "pending_explicit_activation_consent",
    capability: tuple,
    canonicalUrl: canonicalInstallUrl(tuple)
  })}\n`, { mode: 0o600 });
  return project;
}

function errorWithoutPath(reasonCode: string, secretPath: string) {
  return (error: unknown) => error instanceof SuperSkillCliError
    && error.reasonCode === reasonCode
    && !error.message.includes(secretPath)
    && !error.next.includes(secretPath);
}
