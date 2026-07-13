import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  claudeCompatibilitySessionEligible,
  EXACT_ACTIVATION_EVENT_CHAIN,
  inspectCodexActivationToolTrace,
  inspectExactActivationEventChain
} from "./superskill-exact-evidence.js";

const activationId = "act_exact_release";
const row = (kind: string, id = activationId) => ({ activationId: id, kind });

test("accepts one exact ordered activation event chain", () => {
  const evidence = inspectExactActivationEventChain(EXACT_ACTIVATION_EVENT_CHAIN.map((kind) => row(kind)), activationId);
  assert.deepEqual(evidence, {
    valid: true,
    ordered: true,
    unique: true,
    kinds: [...EXACT_ACTIVATION_EVENT_CHAIN]
  });
});

test("rejects an out-of-order activation event chain", () => {
  const kinds = [...EXACT_ACTIVATION_EVENT_CHAIN];
  [kinds[1], kinds[2]] = [kinds[2], kinds[1]];
  const evidence = inspectExactActivationEventChain(kinds.map((kind) => row(kind)), activationId);
  assert.equal(evidence.valid, false);
  assert.equal(evidence.ordered, false);
  assert.equal(evidence.unique, true);
});

test("rejects duplicate and missing activation events", () => {
  const duplicate = inspectExactActivationEventChain([
    ...EXACT_ACTIVATION_EVENT_CHAIN.map((kind) => row(kind)),
    row("activation_ready")
  ], activationId);
  assert.equal(duplicate.valid, false);
  assert.equal(duplicate.unique, false);

  const missing = inspectExactActivationEventChain(
    EXACT_ACTIVATION_EVENT_CHAIN.filter((kind) => kind !== "activation_loaded").map((kind) => row(kind)),
    activationId
  );
  assert.equal(missing.valid, false);
});

test("does not mix events from another activation", () => {
  const rows = [
    row("activation_started", "act_other"),
    ...EXACT_ACTIVATION_EVENT_CHAIN.map((kind) => row(kind))
  ];
  assert.equal(inspectExactActivationEventChain(rows, activationId).valid, true);
});

test("Claude compatibility fails closed without an observed exact Skill tool call", () => {
  assert.equal(claudeCompatibilitySessionEligible({
    skillTraceObserved: true,
    stateEvidence: true,
    eventEvidenceValid: true
  }), true);
  assert.equal(claudeCompatibilitySessionEligible({
    skillTraceObserved: false,
    stateEvidence: true,
    eventEvidenceValid: true
  }), false);
  assert.equal(claudeCompatibilitySessionEligible({
    skillTraceObserved: true,
    stateEvidence: false,
    eventEvidenceValid: true
  }), false);
  assert.equal(claudeCompatibilitySessionEligible({
    skillTraceObserved: true,
    stateEvidence: true,
    eventEvidenceValid: false
  }), false);
});

test("accepts structured Codex exact activation tool executions", () => {
  const requestId = "req_clientsession_codex_fixture";
  const markerRelative = ".agents/skills/superskill-example/.superskill-managed.json";
  const skillRelative = ".agents/skills/superskill-example/SKILL.md";
  const commands = [
    `cat -- ${skillRelative}`,
    `npx --yes onlyharness@0.2.13 activation start --from-pinned ${markerRelative} --activation-request ${requestId} --target codex --consent explicit --json`,
    "npx --yes onlyharness@0.2.13 activation mark act_fixture --state loaded --json",
    "npx --yes onlyharness@0.2.13 activation mark act_fixture --state invoked --json",
    "npx --yes onlyharness@0.2.13 activation finish act_fixture --outcome unknown --evidence unknown --json"
  ];
  const output = commands.map((command, index) => JSON.stringify({
    type: "item.completed",
    item: {
      id: `item_${index}`,
      type: "command_execution",
      command: `/bin/zsh -lc '${command}'`,
      status: "completed",
      exit_code: 0
    }
  })).join("\n");
  const evidence = inspectCodexActivationToolTrace(output, {
    cliVersion: "0.2.13",
    requestId,
    activationId: "act_fixture",
    markerRelative,
    skillRelative
  });
  assert.equal(evidence.valid, true);
  assert.equal(evidence.commandExecutions, 5);
  assert.equal(evidence.rejectedExecutions, 0);
  assert.deepEqual(evidence.executionShapes, ["skillLoad", "startFromPinned", "loaded", "invoked", "finishUnknown"]);
  assert.deepEqual(evidence.failureReasons, []);
  assert.equal(evidence.skillLoadObserved, true);
  assert.deepEqual(Object.values(evidence.requiredOperations), [true, true, true, true]);
});

test("rejects unstructured or incomplete Codex activation traces", () => {
  const input = {
    cliVersion: "0.2.13",
    requestId: "req_clientsession_codex_fixture",
    activationId: "act_fixture",
    markerRelative: ".agents/skills/superskill-example/.superskill-managed.json",
    skillRelative: ".agents/skills/superskill-example/SKILL.md"
  };
  const promptEcho = "Run onlyharness@0.2.13 activation start from pinned";
  assert.equal(inspectCodexActivationToolTrace(promptEcho, input).valid, false);
  const incomplete = JSON.stringify({
    type: "item.completed",
    item: {
      id: "item_0",
      type: "command_execution",
      command: "/bin/zsh -lc 'npx --yes onlyharness@0.2.13 activation mark act_fixture --state loaded --json'",
      status: "completed",
      exit_code: 0
    }
  });
  assert.equal(inspectCodexActivationToolTrace(incomplete, input).valid, false);
});

test("rejects echo, failed, composed, stitched and missing-skill Codex evidence", () => {
  const input = {
    cliVersion: "0.2.13",
    requestId: "req_clientsession_codex_fixture",
    activationId: "act_fixture",
    markerRelative: ".agents/skills/superskill-example/.superskill-managed.json",
    skillRelative: ".agents/skills/superskill-example/SKILL.md"
  };
  const completed = (id: string, command: string, overrides: Record<string, unknown> = {}) => JSON.stringify({
    type: "item.completed",
    item: {
      id,
      type: "command_execution",
      command: `/bin/zsh -lc '${command}'`,
      status: "completed",
      exit_code: 0,
      ...overrides
    }
  });
  const exact = [
    completed("skill", `cat -- ${input.skillRelative}`),
    completed("start", `npx --yes onlyharness@0.2.13 activation start --from-pinned ${input.markerRelative} --activation-request ${input.requestId} --target codex --consent explicit --json`),
    completed("loaded", "npx --yes onlyharness@0.2.13 activation mark act_fixture --state loaded --json"),
    completed("invoked", "npx --yes onlyharness@0.2.13 activation mark act_fixture --state invoked --json"),
    completed("finish", "npx --yes onlyharness@0.2.13 activation finish act_fixture --outcome unknown --evidence unknown --json")
  ];

  const echo = [...exact];
  echo[1] = completed("start", `echo npx --yes onlyharness@0.2.13 activation start --from-pinned ${input.markerRelative} --activation-request ${input.requestId} --target codex --consent explicit --json`);
  assert.equal(inspectCodexActivationToolTrace(echo.join("\n"), input).valid, false);

  const failed = [...exact];
  failed[2] = completed("loaded", "npx --yes onlyharness@0.2.13 activation mark act_fixture --state loaded --json", { status: "failed", exit_code: 1 });
  assert.equal(inspectCodexActivationToolTrace(failed.join("\n"), input).valid, false);

  const composed = [...exact];
  composed[3] = completed("invoked", "true && npx --yes onlyharness@0.2.13 activation mark act_fixture --state invoked --json");
  assert.equal(inspectCodexActivationToolTrace(composed.join("\n"), input).valid, false);

  const stitched = [...exact];
  stitched[1] = completed("start", `npx --yes onlyharness@0.2.13 activation start --from-pinned ${input.markerRelative}`);
  stitched[2] = completed("loaded", `--activation-request ${input.requestId} --target codex --consent explicit --json npx --yes onlyharness@0.2.13 activation mark act_fixture --state loaded --json`);
  assert.equal(inspectCodexActivationToolTrace(stitched.join("\n"), input).valid, false);

  assert.equal(inspectCodexActivationToolTrace(exact.slice(1).join("\n"), input).valid, false);
});

test("checked-in exact-release client evidence is sanitized and non-promotional", () => {
  const evidenceFile = path.resolve(
    import.meta.dirname,
    "../docs/plans/superskill-mvp/evidence/2026-07-13-deep-market-researcher-0.2.1-client-evidence.json"
  );
  const text = readFileSync(evidenceFile, "utf8");
  const evidence = JSON.parse(text) as Record<string, any>;
  assert.equal(evidence.bootstrapOnly, true);
  assert.equal(evidence.promotionAuthorized, false);
  assert.equal(evidence.attestationCreated, false);
  assert.equal(evidence.humanReviewEvidence, false);
  assert.equal(evidence.realClientSessions?.allEligible, true);
  assert.deepEqual(evidence.release, {
    id: "deep-market-researcher",
    ref: "harnesses/deep-market-researcher",
    version: "0.2.1",
    artifactDigest: "sha256:9ebad5b23017dc95b758a77361080f026832538903735cdcb7d9a669f204927e"
  });
  assert.deepEqual(evidence.clients.map((client: Record<string, unknown>) => client.client).sort(), ["claude-code", "codex"]);
  for (const client of evidence.clients) {
    assert.equal(client.realClientSession, "passed");
    assert.equal(client.compatibilitySessionEligible, true);
    assert.match(client.realClientEvidence.environmentHandling, /empty temporary npm user\/global configs/);
    assert.deepEqual(client.realClientEvidence.eventEvidence, {
      valid: true,
      ordered: true,
      unique: true,
      kinds: [...EXACT_ACTIVATION_EVENT_CHAIN]
    });
    if (client.client === "codex") {
      assert.deepEqual(client.realClientEvidence.codexToolEvidence, {
        valid: true,
        commandExecutions: 5,
        rejectedExecutions: 0,
        executionShapes: ["skillLoad", "startFromPinned", "loaded", "invoked", "finishUnknown"],
        failureReasons: [],
        skillLoadObserved: true,
        requiredOperations: {
          startFromPinned: true,
          loaded: true,
          invoked: true,
          finishUnknown: true
        }
      });
    }
  }
  assert.doesNotMatch(text, /\/(?:Users|home|private|tmp)\//);
  assert.doesNotMatch(text, /bootstrap_[A-Za-z0-9_-]{16,}/);
  assert.equal(text.includes("competitor research market map source-backed comparison"), false);
});
