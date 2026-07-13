import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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
const evidenceDirectory = path.resolve(import.meta.dirname, "../docs/plans/superskill-mvp/evidence");
const curatedFile = path.resolve(import.meta.dirname, "../data/superskill/curated.json");

type CuratedResourceRecord = {
  id: string;
  ref: string;
  version: string;
  expectedDigest: string;
  jobs?: Array<{ intents?: unknown; outcomes?: unknown }>;
};

const secretLikePatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\b(?:api[_-]?key|access[_-]?token|token|private[_-]?key|password|secret)\s*[:=]\s*\S{8,}/i,
  /"(?:apiKey|accessToken|token|privateKey|password|secret)"\s*:\s*"[^"]+"/i
];
const pathLikePatterns = [
  /\/(?:Users|home|private|var|tmp)\//,
  /\b[A-Za-z]:\\\\(?:Users|Documents|Projects)\\\\/i
];

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

test("all checked-in current release evidence is exact, sanitized and non-promotional", () => {
  const curated = JSON.parse(readFileSync(curatedFile, "utf8")) as { resources?: CuratedResourceRecord[] };
  const currentResources = curated.resources ?? [];
  assert.equal(currentResources.length, 12, "Expected all 12 current curated resources");
  assert.equal(new Set(currentResources.map((resource) => resource.id)).size, currentResources.length, "Current resource ids must be unique");

  const checkedInEvidenceFiles = readdirSync(evidenceDirectory)
    .filter((name) => name.endsWith("-client-evidence.json"))
    .sort();

  for (const resource of currentResources) {
    const escapedId = resource.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedVersion = resource.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matchingEvidenceFiles = checkedInEvidenceFiles.filter((name) => new RegExp(
      `^\\d{4}-\\d{2}-\\d{2}-${escapedId}-${escapedVersion}-client-evidence\\.json$`
    ).test(name));
    assert.equal(matchingEvidenceFiles.length, 1, `Expected one exact current evidence file for ${resource.id}@${resource.version}`);
    const evidenceFileName = matchingEvidenceFiles[0];
    const text = readFileSync(path.join(evidenceDirectory, evidenceFileName), "utf8");
    const evidence = JSON.parse(text) as Record<string, any>;
    assert.equal(evidence.schemaVersion, "superskill.exact-release-bootstrap-smoke.v1", evidenceFileName);
    assert.equal(evidence.bootstrapOnly, true, evidenceFileName);
    assert.equal(evidence.promotionAuthorized, false, evidenceFileName);
    assert.equal(evidence.attestationCreated, false, evidenceFileName);
    assert.equal(evidence.humanReviewEvidence, false, evidenceFileName);
    assert.equal(evidence.sourceTruthUnchanged, true, evidenceFileName);
    assert.deepEqual(evidence.release, {
      id: resource.id,
      ref: resource.ref,
      version: resource.version,
      artifactDigest: resource.expectedDigest
    }, evidenceFileName);
    assert.deepEqual(evidence.realClientSessions, {
      requested: true,
      filter: "both",
      allEligible: true,
      attemptPolicy: "one bounded fresh session per client; failures stay ineligible"
    }, evidenceFileName);
    assert.deepEqual(
      evidence.clients.map((client: Record<string, unknown>) => client.client).sort(),
      ["claude-code", "codex"],
      evidenceFileName
    );

    for (const client of evidence.clients) {
      assert.equal(client.realClientSession, "passed", `${evidenceFileName}:${client.client}`);
      assert.equal(client.compatibilitySessionEligible, true, `${evidenceFileName}:${client.client}`);
      assert.equal(client.realClientEvidence.status, "passed", `${evidenceFileName}:${client.client}`);
      assert.equal(client.realClientEvidence.compatibilitySessionEligible, true, `${evidenceFileName}:${client.client}`);
      assert.equal(client.realClientEvidence.publicOutputSanitized, true, `${evidenceFileName}:${client.client}`);
      assert.match(client.realClientEvidence.environmentHandling, /empty temporary npm user\/global configs/);

      const clientActivationId = `act_${resource.id}_${client.client}`;
      const inspectedLifecycle = inspectExactActivationEventChain(
        client.realClientEvidence.lifecycle.map((kind: string) => ({ activationId: clientActivationId, kind })),
        clientActivationId
      );
      assert.deepEqual(inspectedLifecycle, {
        valid: true,
        ordered: true,
        unique: true,
        kinds: [...EXACT_ACTIVATION_EVENT_CHAIN]
      }, `${evidenceFileName}:${client.client}`);
      assert.deepEqual(client.realClientEvidence.eventEvidence, inspectedLifecycle, `${evidenceFileName}:${client.client}`);
      assert.deepEqual(client.realClientEvidence.outcome, { value: "unknown", evidence: "unknown" }, `${evidenceFileName}:${client.client}`);
      assert.deepEqual(client.outcome, { value: "unknown", evidence: "unknown" }, `${evidenceFileName}:${client.client}`);

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
        }, evidenceFileName);
      }
    }

    assert.deepEqual(evidence.privacy, {
      tokenPersistedInProjectOrEvents: false,
      taskPersistedInProjectOrEvents: false,
      absolutePathIncludedInPublicReportOrEvents: false
    }, evidenceFileName);
    assert.doesNotMatch(text, /bootstrap_[A-Za-z0-9_-]{16,}/, evidenceFileName);
    for (const pattern of [...secretLikePatterns, ...pathLikePatterns]) assert.doesNotMatch(text, pattern, evidenceFileName);

    const firstIntent = resource.jobs?.[0]?.intents;
    const smokeTask = resource.id === "deep-market-researcher"
      ? "competitor research market map source-backed comparison"
      : Array.isArray(firstIntent) && typeof firstIntent[0] === "string"
        ? firstIntent[0].trim().replace(/\s+/g, " ")
        : undefined;
    assert.ok(smokeTask, `Missing smoke task contract for ${resource.id}`);
    assert.equal(text.includes(smokeTask), false, `${evidenceFileName}: task summary leaked`);
  }
});
