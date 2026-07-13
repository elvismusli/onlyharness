import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { validateHarnessDir } from "@harnesshub/schema";
import { computeArtifactDigest, packageDigest, sha256Digest, validateManagedArchive } from "../lib/artifact.js";
import {
  assertSafePathUnder,
  assertSafeStatePath,
  clearRemovalIntent,
  findActivationByRequest,
  inspectProjectState,
  listActivations,
  readActivation,
  readActivationPlan,
  readRemovalIntent,
  resolveProjectState,
  resolveProjectRoot,
  queueEvent,
  withProjectLock,
  writeActivation,
  writeActivationPlan,
  writeRemovalIntent,
  type ProjectState
} from "../lib/activation-store.js";
import { clientAdapter, readPinnedMarker, safeCapabilitySlug, scanInventory } from "../lib/client-adapters.js";
import { acknowledgePendingSuperSkillHandoff } from "../lib/superskill-handoff.js";
import {
  computeDecisionDigest,
  fetchExactRelease,
  fetchManagedArchive,
  flushManagedEvents,
  requireSuperSkillToken,
  sendManagedEvent
} from "../lib/superskill-client.js";
import type {
  ActivationPlan,
  ActivationRecord,
  ExecutionState,
  ManagedCapability,
  ManagedEvent,
  ManagedPinnedMarker,
  OutcomeEvidence,
  SuperSkillClient
} from "../lib/superskill-types.js";
import {
  CAPABILITY_ID_RE,
  DIGEST_RE,
  RECOMMENDATION_ID_RE,
  REQUEST_ID_RE,
  SUPERSKILL_RUNTIME,
  SuperSkillCliError
} from "../lib/superskill-types.js";
import { opaqueId, parseClient, runManagedAction } from "./recommend.js";

type RegistrySource = () => string;

export function registerActivationCommands(program: Command, registry: RegistrySource): void {
  const activation = program.command("activation").description("manage consent-bound SuperSkill activations");

  activation.command("start")
    .description("download and verify an exact reviewed release, or recheck a pinned skill")
    .argument("[capability-id]")
    .option("--version <semver>")
    .option("--digest <sha256>")
    .option("--recommendation <id>")
    .option("--decision-digest <sha256>")
    .option("--recommendation-expires-at <rfc3339>")
    .requiredOption("--activation-request <id>")
    .requiredOption("--target <target>", "claude-code|codex")
    .option("--mode <mode>", "temporary", "temporary")
    .requiredOption("--consent <value>", "must be explicit")
    .option("--from-pinned <marker>")
    .option("--project-dir <path>")
    .option("--json", "print JSON", false)
    .action(async (capabilityId: string | undefined, options) => runManagedAction(Boolean(options.json), async () => {
      const result = await startActivation({
        registry: registry(),
        projectDir: options.projectDir,
        capabilityId,
        version: options.version,
        digest: options.digest,
        recommendationId: options.recommendation,
        decisionDigest: options.decisionDigest,
        recommendationExpiresAt: options.recommendationExpiresAt,
        activationRequestId: options.activationRequest,
        client: parseClient(options.target),
        mode: options.mode,
        consent: options.consent,
        fromPinned: options.fromPinned
      });
      writeResult(result, options.json, `Activation ${result.activationId} is ready. It is not loaded or invoked yet.`);
    }));

  activation.command("mark")
    .description("record loaded or invoked without implying task outcome")
    .argument("<activation-id>")
    .requiredOption("--state <state>", "loaded|invoked|failed")
    .option("--reason <reason-code>")
    .option("--project-dir <path>")
    .option("--json", "print JSON", false)
    .action(async (activationId: string, options) => runManagedAction(Boolean(options.json), async () => {
      const result = await markActivation(registry(), options.projectDir, activationId, options.state, options.reason);
      writeResult(result, options.json, `Activation ${activationId}: ${result.executionState}.`);
    }));

  activation.command("finish")
    .description("record an agent-reported or user-confirmed outcome")
    .argument("<activation-id>")
    .requiredOption("--outcome <outcome>", "success|failed|unknown")
    .requiredOption("--evidence <evidence>", "agent_reported|user_confirmed|unknown")
    .option("--project-dir <path>")
    .option("--json", "print JSON", false)
    .action(async (activationId: string, options) => runManagedAction(Boolean(options.json), async () => {
      const result = await finishActivation(registry(), options.projectDir, activationId, options.outcome, options.evidence);
      writeResult(result, options.json, `Activation ${activationId}: ${result.executionState} (${result.outcome.evidence}).`);
    }));

  activation.command("keep")
    .description("pin a completed activation into the target-native skill directory")
    .argument("<activation-id>")
    .option("--confirm-keep", "confirm persistent managed files", false)
    .option("--project-dir <path>")
    .option("--json", "print JSON", false)
    .action(async (activationId: string, options) => runManagedAction(Boolean(options.json), async () => {
      const result = await keepActivation(registry(), options.projectDir, activationId, Boolean(options.confirmKeep));
      writeResult(result, options.json, `Pinned ${result.managedFiles.join(", ")} (detected on disk; not claimed loaded).`);
    }));

  activation.command("remove")
    .description("safely remove one digest-owned managed pin; works offline")
    .requiredOption("--marker <path>", "project-relative .superskill-managed.json")
    .option("--confirm-remove", "confirm managed deletion", false)
    .option("--project-dir <path>")
    .option("--json", "print JSON", false)
    .action(async (options) => runManagedAction(Boolean(options.json), async () => {
      const result = await removeActivation(options.projectDir, options.marker, Boolean(options.confirmRemove));
      writeResult(result, options.json, result.alreadyRemoved ? "Managed pin was already removed." : `Removed ${result.removedFiles.length} managed file(s).`);
    }));

  activation.command("doctor")
    .description("inspect managed client inventory and optionally recheck exact releases")
    .requiredOption("--target <target>", "claude-code|codex")
    .option("--live", "recheck managed exact releases (uses HH_TOKEN; legacy HH_SUPERSKILL_TOKEN is compatibility only)", false)
    .option("--project-dir <path>")
    .option("--json", "print JSON", false)
    .action(async (options) => runManagedAction(Boolean(options.json), async () => {
      const result = await activationDoctor(registry(), options.projectDir, parseClient(options.target), Boolean(options.live));
      writeResult(result, options.json, `SuperSkill doctor: ${result.status}; ${result.managed.length} managed pin(s).`);
    }));
}

export async function startActivation(input: {
  registry: string;
  projectDir?: string;
  capabilityId?: string;
  version?: string;
  digest?: string;
  recommendationId?: string;
  decisionDigest?: string;
  recommendationExpiresAt?: string;
  activationRequestId: string;
  client: SuperSkillClient;
  mode: string;
  consent: string;
  fromPinned?: string;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  if (input.consent !== "explicit") throw consentRequired("Activation requires --consent explicit after disclosure.");
  if (!REQUEST_ID_RE.test(input.activationRequestId)) throw invalid("Activation request ID must start with req_ and contain at least 8 URL-safe random characters.", "ACTIVATION_REQUEST_INVALID");
  if (input.fromPinned) return startFromPinned(input);
  if (input.mode !== "temporary") throw invalid("New managed activation must start in temporary mode.", "ACTIVATION_INVALID_MODE");
  if (!input.capabilityId || !CAPABILITY_ID_RE.test(input.capabilityId)) throw invalid("A valid capability ID is required.", "CAPABILITY_NOT_FOUND");
  if (!input.version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(input.version)) throw invalid("An exact --version is required.", "ARTIFACT_NOT_IMMUTABLE");
  if (!input.digest || !DIGEST_RE.test(input.digest)) throw invalid("An exact --digest is required.", "ARTIFACT_DIGEST_MISMATCH");
  if (!input.decisionDigest || !DIGEST_RE.test(input.decisionDigest)) throw staleConsent();
  if (!input.recommendationId || !RECOMMENDATION_ID_RE.test(input.recommendationId)) throw staleConsent();
  const expiry = Date.parse(input.recommendationExpiresAt ?? "");
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw staleConsent();
  requireSuperSkillToken();

  // Fail closed on the complete live tuple and in-memory archive before creating
  // project state. A stale/revoked/digest-mismatched/path-unsafe decision must
  // leave no local activation record or cache behind.
  const exact = await fetchExactRelease({ registry: input.registry, capabilityId: input.capabilityId, version: input.version, signal: input.signal });
  const capability = exact.capability;
  assertExactCapability(capability, input.capabilityId, input.version, input.digest, input.client);
  if (!exact.activationAllowed || !exact.archive) throw blockedRelease(exact.blockCode, exact.replacement);
  if (exact.archive.artifactDigest !== input.digest) throw new SuperSkillCliError("Exact release archive digest changed after consent.", 3, "ARTIFACT_DIGEST_MISMATCH", "Request a new recommendation; do not download this release.");
  if (computeDecisionDigest(capability, input.client, input.recommendationExpiresAt!, input.recommendationId) !== input.decisionDigest) throw staleConsent();
  const archive = await fetchManagedArchive({ registry: input.registry, archiveUrl: exact.archive.url, signal: input.signal });
  validateManagedArchive(archive, { version: input.version, digest: input.digest });

  assertRequestActive(input.signal);
  const state = resolveProjectState(input.projectDir);
  return withProjectLock(state, `request-${input.activationRequestId}`, async () => {
    assertRequestActive(input.signal);
    const tuple = { id: input.capabilityId!, ref: "", version: input.version!, artifactDigest: input.digest! };
    const existing = findActivationByRequest(state, input.activationRequestId);
    if (existing) {
      assertSameRequest(existing, { ...tuple, ref: existing.capability.ref }, input.client, input.recommendationId);
      if (existing.executionState === "failed") throw new SuperSkillCliError("The activation request previously failed.", 3, "ACTIVATION_FAILED", "Create a new request ID after resolving the failure.");
      if (["ready", "loaded", "invoked", "outcome_success", "outcome_failed", "outcome_unknown"].includes(existing.executionState)) {
        const cacheRoot = path.join(state.stateRoot, "cache", "sha256", input.digest!.slice("sha256:".length));
        assertSafeStatePath(state, cacheRoot);
        verifyCache(cacheRoot, archive.files, input.digest!);
        acknowledgePendingSuperSkillHandoff(state.projectRoot, tuple);
        return startResult(state, existing);
      }
    }
    const now = new Date().toISOString();
    const record: ActivationRecord = existing ?? {
      schemaVersion: "superskill.activation.v1",
      activationId: opaqueId("act"),
      activationRequestId: input.activationRequestId,
      projectRoot: state.projectRoot,
      recommendationId: input.recommendationId,
      mode: "temporary",
      capability: tuple,
      client: input.client,
      executionState: "accepted",
      pinState: "none",
      createdAt: now,
      updatedAt: now
    };
    assertRequestActive(input.signal);
    writeActivation(state, record);
    const staging = path.join(state.stateRoot, "staging", record.activationId);
    try {
      assertRequestActive(input.signal);
      assertSafeStatePath(state, staging);
      rmSync(staging, { recursive: true, force: true });
      record.capability.ref = capability.release.ref;
      record.executionState = "downloading";
      assertRequestActive(input.signal);
      writeActivation(state, record);
      mkdirSync(staging, { recursive: true, mode: 0o700 });
      assertSafeStatePath(state, staging);
      for (const file of archive.files) {
        assertRequestActive(input.signal);
        const target = path.join(staging, file.path);
        assertSafePathUnder(staging, target, "managed staging file");
        mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        assertSafePathUnder(staging, target, "managed staging file");
        writeFileSync(target, file.content, { mode: 0o600 });
        assertSafePathUnder(staging, target, "managed staging file");
      }
      const validation = validateHarnessDir(staging);
      if (!validation.valid || !validation.manifest) throw invalid("Downloaded managed artifact is not a valid native harness.", "ARTIFACT_NOT_IMMUTABLE");
      if (validation.manifest.version !== input.version) throw invalid("Native manifest version does not match the consented release.", "ARTIFACT_DIGEST_MISMATCH");
      const plan = buildActivationPlan(staging, validation.manifest as unknown as HarnessPlanManifest);
      record.executionState = "digest_verified";
      assertRequestActive(input.signal);
      writeActivation(state, record);
      const cacheRoot = path.join(state.stateRoot, "cache", "sha256", input.digest!.slice("sha256:".length));
      await withProjectLock(state, `cache-${input.digest!.slice("sha256:".length)}`, async () => {
        assertSafeStatePath(state, cacheRoot);
        if (existsSync(cacheRoot)) {
          verifyCache(cacheRoot, archive.files, input.digest!);
          rmSync(staging, { recursive: true, force: true });
        } else {
          assertSafeStatePath(state, staging);
          const cacheMarker = path.join(staging, ".superskill-cache.json");
          assertSafePathUnder(staging, cacheMarker, "managed cache marker");
          writeFileSync(cacheMarker, `${JSON.stringify({ artifactDigest: input.digest, files: archive.files.map((file) => file.path) }, null, 2)}\n`, { mode: 0o400 });
          assertSafePathUnder(staging, cacheMarker, "managed cache marker");
          assertSafeStatePath(state, cacheRoot);
          renameSync(staging, cacheRoot);
          assertSafeStatePath(state, cacheRoot);
          for (const file of archive.files) chmodSync(path.join(cacheRoot, file.path), 0o400);
        }
      });
      writeActivationPlan(state, record.activationId, relocatePlan(plan, staging, cacheRoot));
      record.executionState = "ready";
      assertRequestActive(input.signal);
      writeActivation(state, record);
      acknowledgePendingSuperSkillHandoff(state.projectRoot, record.capability);
      queueLifecycleEvents(state, record, ["recommendation_accepted", "activation_started", "activation_ready"]);
      void flushManagedEvents(input.registry, state).catch(() => undefined);
      return startResult(state, record);
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      if (error instanceof SuperSkillCliError && error.reasonCode === "REQUEST_CANCELLED") {
        rmSync(path.join(state.stateRoot, "activations", `${record.activationId}.json`), { force: true });
        rmSync(path.join(state.stateRoot, "activation-plans", `${record.activationId}.json`), { force: true });
        throw error;
      }
      record.executionState = "failed";
      writeActivation(state, record);
      queueEvent(state, managedEvent(record, "activation_failed", { reasonCode: error instanceof SuperSkillCliError ? error.reasonCode : "ACTIVATION_FAILED" }));
      void flushManagedEvents(input.registry, state).catch(() => undefined);
      throw error;
    }
  });
}

async function startFromPinned(input: {
  registry: string;
  projectDir?: string;
  activationRequestId: string;
  client: SuperSkillClient;
  consent: string;
  fromPinned?: string;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  requireSuperSkillToken();
  const projectRoot = resolveProjectRoot(input.projectDir);
  const markerRelative = safeRelativeMarker(input.fromPinned!);
  const markerFile = path.resolve(projectRoot, markerRelative);
  assertInside(projectRoot, markerFile);
  assertSafePathUnder(projectRoot, markerFile, "pinned marker");
  const marker = readPinnedMarker(markerFile)!;
  if (marker.client !== input.client) throw invalid("Pinned skill belongs to a different client.", "CLIENT_UNSUPPORTED");
  const expectedMarker = clientAdapter(marker.client).markerPath(projectRoot, marker.capabilityId);
  if (path.resolve(expectedMarker) !== markerFile) throw invalid("Pinned marker is outside the target-native managed path.", "MANAGED_FILE_CHANGED");
  const exact = await fetchExactRelease({ registry: input.registry, capabilityId: marker.capabilityId, version: marker.version, signal: input.signal });
  assertExactCapability(exact.capability, marker.capabilityId, marker.version, marker.artifactDigest, input.client);
  if (!exact.activationAllowed) throw blockedRelease(exact.blockCode, exact.replacement);
  verifyPinnedPackage(path.dirname(markerFile), marker);
  assertRequestActive(input.signal);
  const state = resolveProjectState(projectRoot);
  return withProjectLock(state, `request-${input.activationRequestId}`, async () => {
    const existing = findActivationByRequest(state, input.activationRequestId);
    const tuple = { id: marker.capabilityId, ref: marker.ref, version: marker.version, artifactDigest: marker.artifactDigest };
    if (existing) {
      assertSameRequest(existing, tuple, input.client, undefined);
      if (existing.sourceMarkerPath !== markerRelative) throw collision("Activation request ID was already used for another pinned source.");
      if (existing.executionState === "failed") throw new SuperSkillCliError("The pinned activation request previously failed.", 3, "ACTIVATION_FAILED", "Create a new request ID after resolving the failure.");
      return startResult(state, existing);
    }
    const now = new Date().toISOString();
    const record: ActivationRecord = {
      schemaVersion: "superskill.activation.v1",
      activationId: opaqueId("act"),
      activationRequestId: input.activationRequestId,
      projectRoot: state.projectRoot,
      mode: "pinned",
      sourceMarkerPath: markerRelative,
      capability: tuple,
      client: input.client,
      executionState: "ready",
      pinState: "pinned",
      createdAt: now,
      updatedAt: now
    };
    writeActivationPlan(state, record.activationId, {
        root: path.dirname(markerFile),
        files: Object.keys(marker.managedFiles).sort().map((file) => ({
          path: safeArtifactRelative(file),
          purpose: file === "SKILL.md" ? "agent_prompt" as const : "runbook" as const
        })),
        stages: [{ id: "pinned-use", agent: "superskill-pinned", promptPath: "SKILL.md" }]
      });
    writeActivation(state, record);
    queueLifecycleEvents(state, record, ["activation_started", "activation_ready"]);
    void flushManagedEvents(input.registry, state).catch(() => undefined);
    return startResult(state, record);
  });
}

function assertRequestActive(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new SuperSkillCliError("SuperSkill request was cancelled.", 3, "REQUEST_CANCELLED", "No local activation state was created. Retry with fresh consent if the task is still wanted.");
  }
}

export async function markActivation(registry: string, projectDir: string | undefined, activationId: string, next: string, reason?: string): Promise<Record<string, unknown>> {
  const state = resolveProjectState(projectDir);
  return withProjectLock(state, `activation-${activationId}`, async () => {
    const record = readActivation(state, activationId);
    if (next === record.executionState) return localStateResult(record);
    const allowed: Partial<Record<ExecutionState, ExecutionState[]>> = {
      ready: ["loaded", "failed"],
      loaded: ["invoked", "failed"],
      accepted: ["failed"],
      downloading: ["failed"],
      digest_verified: ["failed"],
      invoked: ["failed"]
    };
    if (!isExecutionState(next) || !allowed[record.executionState]?.includes(next)) throw invalidTransition(record.executionState, next);
    if (next === "failed") {
      if (!reason || !/^[A-Z][A-Z0-9_]{2,63}$/.test(reason)) throw invalid("A whitelisted uppercase --reason code is required for failed state.", "ACTIVATION_INVALID_TRANSITION");
    }
    record.executionState = next;
    writeActivation(state, record);
    if (next === "loaded") await emitForRecord(registry, state, record, "activation_loaded");
    if (next === "invoked") await emitForRecord(registry, state, record, "activation_invoked");
    if (next === "failed") await emitForRecord(registry, state, record, "activation_failed", { reasonCode: reason });
    return localStateResult(record);
  });
}

export async function finishActivation(
  registry: string,
  projectDir: string | undefined,
  activationId: string,
  outcome: string,
  evidence: string
): Promise<{ activationId: string; executionState: ExecutionState; pinState: string; outcome: { value: string; evidence: OutcomeEvidence } }> {
  if (!(["success", "failed", "unknown"] as string[]).includes(outcome)) throw invalid("Invalid outcome.", "ACTIVATION_INVALID_TRANSITION");
  if (!(["agent_reported", "user_confirmed", "unknown"] as string[]).includes(evidence)) throw invalid("Invalid outcome evidence.", "ACTIVATION_INVALID_TRANSITION");
  if (outcome === "success" && evidence === "unknown") throw invalid("A success outcome requires agent_reported or user_confirmed evidence.", "ACTIVATION_INVALID_TRANSITION");
  const state = resolveProjectState(projectDir);
  return withProjectLock(state, `activation-${activationId}`, async () => {
    const record = readActivation(state, activationId);
    const nextState = `outcome_${outcome}` as ExecutionState;
    if (record.executionState === "invoked") {
      record.executionState = nextState;
      record.outcome = { value: outcome as "success" | "failed" | "unknown", evidence: evidence as OutcomeEvidence };
      writeActivation(state, record);
      await emitForRecord(registry, state, record, "outcome_reported", { outcome: record.outcome.value, evidence: record.outcome.evidence });
    } else if (record.executionState === nextState && record.outcome?.value === outcome) {
      if (record.outcome.evidence === evidence) return finishResult(record);
      if (evidence === "user_confirmed" && record.outcome.evidence !== "user_confirmed") {
        record.outcome.evidence = "user_confirmed";
        writeActivation(state, record);
        await emitForRecord(registry, state, record, "outcome_reported", { outcome: record.outcome.value, evidence: "user_confirmed" });
      } else {
        throw invalid("Outcome evidence can only upgrade to user_confirmed.", "ACTIVATION_INVALID_TRANSITION");
      }
    } else {
      throw invalidTransition(record.executionState, nextState);
    }
    return finishResult(record);
  });
}

export async function keepActivation(registry: string, projectDir: string | undefined, activationId: string, confirmed: boolean, signal?: AbortSignal): Promise<{
  executionState: ExecutionState;
  pinState: "pinned";
  client: SuperSkillClient;
  managedFiles: string[];
  doctor: { status: "detected_on_disk" };
}> {
  if (!confirmed) throw consentRequired("Keeping a managed skill requires --confirm-keep after a completed outcome.");
  assertRequestActive(signal);
  requireSuperSkillToken();
  const state = resolveProjectState(projectDir);
  return withProjectLock(state, `activation-${activationId}`, async () => {
    assertRequestActive(signal);
    const record = readActivation(state, activationId);
    if (!isOutcomeState(record.executionState)) throw invalid("Only a completed outcome can be pinned.", "ACTIVATION_INVALID_TRANSITION");
    if (record.mode === "pinned" && record.pinState === "pinned" && record.sourceMarkerPath) {
      const markerFile = path.resolve(state.projectRoot, record.sourceMarkerPath);
      const existing = readPinnedMarker(markerFile)!;
      verifyPinnedPackage(path.dirname(markerFile), existing);
      return {
        executionState: record.executionState,
        pinState: "pinned",
        client: record.client,
        managedFiles: Object.keys(existing.managedFiles).map((file) => projectRelative(state.projectRoot, path.join(path.dirname(markerFile), file))),
        doctor: { status: "detected_on_disk" }
      };
    }
    if (record.pinState === "pinned" && record.pinned) {
      const existing = readPinnedMarker(path.resolve(state.projectRoot, record.pinned.markerPath))!;
      verifyPinnedPackage(path.dirname(path.resolve(state.projectRoot, record.pinned.markerPath)), existing);
      return keepResult(record, Object.keys(existing.managedFiles));
    }
    const plan = readActivationPlan(state, record.activationId);
    assertTemporaryPlanRoot(state, record, plan);
    const exact = await fetchExactRelease({ registry, capabilityId: record.capability.id, version: record.capability.version, signal });
    assertRequestActive(signal);
    assertExactCapability(exact.capability, record.capability.id, record.capability.version, record.capability.artifactDigest, record.client);
    if (!exact.activationAllowed) throw blockedRelease(exact.blockCode, exact.replacement);
    const adapter = clientAdapter(record.client);
    const markerFile = adapter.markerPath(state.projectRoot, record.capability.id);
    const targetRoot = path.dirname(markerFile);
    const markerRelative = projectRelative(state.projectRoot, markerFile);
    assertSafePathUnder(state.projectRoot, targetRoot, "pinned skill root");
    if (existsSync(targetRoot)) {
      const adopt = readPinnedMarker(markerFile, false);
      if (!adopt
        || adopt.pinActivationId !== record.activationId
        || adopt.pinRequestId !== record.activationRequestId
        || adopt.capabilityId !== record.capability.id
        || adopt.version !== record.capability.version
        || adopt.artifactDigest !== record.capability.artifactDigest) {
        throw collision(`Target already exists: ${projectRelative(state.projectRoot, targetRoot)}.`);
      }
      verifyPinnedPackage(targetRoot, adopt);
      const markerText = readFileSync(markerFile);
      assertRequestActive(signal);
      record.pinState = "pinned";
      record.pinned = { markerPath: markerRelative, markerDigest: sha256Digest(markerText), packageDigest: adopt.packageDigest };
      writeActivation(state, record);
      await emitForRecord(registry, state, record, "activation_pinned");
      return keepResult(record, Object.keys(adopt.managedFiles));
    }
    mkdirSync(path.dirname(targetRoot), { recursive: true });
    assertSafePathUnder(state.projectRoot, path.dirname(targetRoot), "pinned skill parent");
    assertSafePathUnder(state.projectRoot, targetRoot, "pinned skill root");
    const staging = `${targetRoot}.tmp-${process.pid}-${randomBytes(5).toString("hex")}`;
    assertSafePathUnder(state.projectRoot, staging, "pinned staging root");
    assertRequestActive(signal);
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(path.join(staging, "references", "resource"), { recursive: true, mode: 0o700 });
    assertSafePathUnder(state.projectRoot, staging, "pinned staging root");
    let renamed = false;
    let activationWritten = false;
    try {
      const managedFiles: Record<string, string> = {};
      for (const planFile of plan.files) {
        const relative = safeArtifactRelative(planFile.path);
        const source = path.resolve(plan.root, relative);
        assertInside(plan.root, source);
        if (!existsSync(source) || lstatSync(source).isSymbolicLink() || !statSync(source).isFile()) throw invalid(`Activation plan file is missing or unsafe: ${relative}.`, "MANAGED_FILE_CHANGED");
        const destinationRelative = path.posix.join("references/resource", relative.split(path.sep).join("/"));
        const destination = path.join(staging, destinationRelative);
        assertSafePathUnder(staging, destination, "pinned managed file");
        mkdirSync(path.dirname(destination), { recursive: true });
        assertSafePathUnder(staging, destination, "pinned managed file");
        copyFileSync(source, destination);
        assertSafePathUnder(staging, destination, "pinned managed file");
        managedFiles[destinationRelative] = sha256Digest(readFileSync(destination));
      }
      const skill = generatedPinnedSkill(record, exact.capability, markerRelative, plan);
      const skillFile = path.join(staging, "SKILL.md");
      assertSafePathUnder(staging, skillFile, "pinned skill file");
      writeFileSync(skillFile, skill, { mode: 0o600 });
      assertSafePathUnder(staging, skillFile, "pinned skill file");
      managedFiles["SKILL.md"] = sha256Digest(Buffer.from(skill));
      const pkgDigest = packageDigest(managedFiles);
      const marker: ManagedPinnedMarker = {
        schemaVersion: "superskill.pinned.v1",
        client: record.client,
        capabilityId: safeCapabilitySlug(record.capability.id),
        ref: record.capability.ref,
        version: record.capability.version,
        artifactDigest: record.capability.artifactDigest,
        cliPackage: SUPERSKILL_RUNTIME.cliPackage,
        cliVersion: SUPERSKILL_RUNTIME.cliVersion,
        activationContractVersion: SUPERSKILL_RUNTIME.activationContractVersion,
        pinActivationId: record.activationId,
        pinRequestId: record.activationRequestId,
        managedFiles,
        packageDigest: pkgDigest
      };
      const markerText = `${JSON.stringify(marker, null, 2)}\n`;
      const stagedMarker = path.join(staging, ".superskill-managed.json");
      assertSafePathUnder(staging, stagedMarker, "pinned marker");
      writeFileSync(stagedMarker, markerText, { mode: 0o600 });
      assertSafePathUnder(staging, stagedMarker, "pinned marker");
      assertSafePathUnder(state.projectRoot, staging, "pinned staging root");
      assertSafePathUnder(state.projectRoot, targetRoot, "pinned skill root");
      assertRequestActive(signal);
      renameSync(staging, targetRoot);
      renamed = true;
      assertSafePathUnder(state.projectRoot, targetRoot, "pinned skill root");
      assertSafePathUnder(state.projectRoot, markerFile, "pinned marker");
      record.pinState = "pinned";
      record.pinned = { markerPath: markerRelative, markerDigest: sha256Digest(Buffer.from(markerText)), packageDigest: pkgDigest };
      assertRequestActive(signal);
      writeActivation(state, record);
      activationWritten = true;
      await emitForRecord(registry, state, record, "activation_pinned");
      return keepResult(record, Object.keys(managedFiles));
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      if (renamed && !activationWritten) rmSync(targetRoot, { recursive: true, force: true });
      throw error;
    }
  });
}

export async function removeActivation(projectDir: string | undefined, markerInput: string, confirmed: boolean): Promise<{
  pinState: "removed";
  marker: string;
  removedFiles: string[];
  alreadyRemoved: boolean;
}> {
  if (!confirmed) throw consentRequired("Removing a managed skill requires --confirm-remove.");
  const state = resolveProjectState(projectDir);
  const markerRelative = safeRelativeMarker(markerInput);
  const markerFile = path.resolve(state.projectRoot, markerRelative);
  assertInside(state.projectRoot, markerFile);
  return withProjectLock(state, `remove-${sha256Digest(markerRelative).slice(7, 23)}`, async () => {
    if (!existsSync(markerFile)) {
      const intent = readRemovalIntent(state, markerRelative);
      const removed = listActivations(state).find((record) => record.pinned?.markerPath === markerRelative && (record.pinState === "removed" || intent?.activationId === record.activationId));
      if (removed) {
        if (removed.pinState !== "removed") {
          removed.pinState = "removed";
          writeActivation(state, removed);
        }
        clearRemovalIntent(state, markerRelative);
        const { queueEvent } = await import("../lib/activation-store.js");
        queueEvent(state, managedEvent(removed, "activation_removed"));
        return { pinState: "removed", marker: markerRelative, removedFiles: [], alreadyRemoved: true };
      }
      throw new SuperSkillCliError("Managed marker is missing, so ownership cannot be proven.", 4, "ACTIVATION_NOT_FOUND", "No files were changed. Use the recorded marker path or clean up manually after review.");
    }
    assertNoSymlinkAncestors(state.projectRoot, markerFile);
    const marker = readPinnedMarker(markerFile)!;
    const expected = clientAdapter(marker.client).markerPath(state.projectRoot, marker.capabilityId);
    if (path.resolve(expected) !== markerFile) throw invalid("Managed marker is outside its exact client-native path.", "MANAGED_FILE_CHANGED");
    const record = readActivation(state, marker.pinActivationId);
    if (record.pinState === "removed") return { pinState: "removed", marker: markerRelative, removedFiles: [], alreadyRemoved: true };
    if (record.pinState !== "pinned" || !record.pinned || record.pinned.markerPath !== markerRelative) throw invalid("Owning activation does not match the marker.", "MANAGED_FILE_CHANGED");
    const markerText = readFileSync(markerFile);
    if (sha256Digest(markerText) !== record.pinned.markerDigest || marker.packageDigest !== record.pinned.packageDigest || packageDigest(marker.managedFiles) !== marker.packageDigest) {
      throw changedFile("Managed marker/package digest changed.");
    }
    const root = path.dirname(markerFile);
    const existing: Array<{ relative: string; file: string }> = [];
    for (const [relativeInput, digest] of Object.entries(marker.managedFiles)) {
      const relative = safeArtifactRelative(relativeInput);
      const file = path.resolve(root, relative);
      assertInside(root, file);
      assertNoSymlinkAncestors(root, file);
      if (!existsSync(file)) continue;
      if (lstatSync(file).isSymbolicLink() || !statSync(file).isFile()) throw changedFile(`Managed path is no longer a regular file: ${relative}.`);
      if (sha256Digest(readFileSync(file)) !== digest) throw changedFile(`Managed file changed: ${relative}.`);
      existing.push({ relative, file });
    }
    existing.sort((a, b) => b.file.length - a.file.length);
    writeRemovalIntent(state, { markerPath: markerRelative, activationId: record.activationId });
    for (const entry of existing) unlinkSync(entry.file);
    unlinkSync(markerFile);
    for (const directory of [...new Set(existing.map((entry) => path.dirname(entry.file)))].sort((a, b) => b.length - a.length)) {
      removeEmptyDirectories(directory, root);
    }
    removeEmptyDirectories(root, clientAdapter(marker.client).pinnedRoot(state.projectRoot));
    record.pinState = "removed";
    writeActivation(state, record);
    clearRemovalIntent(state, markerRelative);
    const event = managedEvent(record, "activation_removed");
    // Offline remove queues the event without requiring or reading the token.
    const { queueEvent } = await import("../lib/activation-store.js");
    queueEvent(state, event);
    return { pinState: "removed", marker: markerRelative, removedFiles: existing.map((entry) => projectRelative(state.projectRoot, entry.file)), alreadyRemoved: false };
  });
}

export async function removeActivationById(projectDir: string | undefined, activationId: string, confirmed: boolean): Promise<{
  pinState: "removed";
  marker: string;
  removedFiles: string[];
  alreadyRemoved: boolean;
}> {
  if (!confirmed) throw consentRequired("Removing a managed skill requires explicit remove confirmation.");
  if (!/^act_[A-Za-z0-9_-]{8,120}$/.test(activationId)) {
    throw invalid("A valid activation ID is required for managed removal.", "ACTIVATION_NOT_FOUND");
  }
  const state = resolveProjectState(projectDir);
  const record = readActivation(state, activationId);
  const marker = record.pinned?.markerPath ?? record.sourceMarkerPath;
  if (!marker || record.pinState === "none") {
    throw invalid("The activation does not own a managed pin.", "ACTIVATION_NOT_FOUND");
  }
  return removeActivation(state.projectRoot, marker, true);
}

export async function activationDoctor(registry: string, projectDir: string | undefined, client: SuperSkillClient, live: boolean, signal?: AbortSignal): Promise<{
  status: "healthy" | "attention";
  client: SuperSkillClient;
  plugin: ReturnType<ReturnType<typeof clientAdapter>["pluginDoctor"]>;
  inventory: ReturnType<typeof scanInventory>;
  managed: Array<Record<string, unknown>>;
}> {
  const projectRoot = resolveProjectRoot(projectDir);
  const state = inspectProjectState(projectRoot);
  const adapter = clientAdapter(client);
  const inventory = scanInventory(client, projectRoot);
  const plugin = adapter.pluginDoctor(projectRoot);
  const managed: Array<Record<string, unknown>> = [];
  const activationDir = state ? path.join(state.stateRoot, "activations") : undefined;
  const records = state && activationDir && existsSync(activationDir) ? listActivations(state) : [];
  for (const record of records.filter((item) => item.client === client && item.pinState === "pinned" && item.pinned)) {
    let status: "detected_on_disk" | "changed" | "approved" | "permission_blocked" | "quarantined" | "revoked" | "unavailable" = "detected_on_disk";
    let next: string | undefined;
    try {
      const marker = readPinnedMarker(path.resolve(projectRoot, record.pinned!.markerPath))!;
      verifyPinnedPackage(path.dirname(path.resolve(projectRoot, record.pinned!.markerPath)), marker);
      if (live) {
        const exact = await fetchExactRelease({ registry, capabilityId: marker.capabilityId, version: marker.version, signal });
        status = exact.activationAllowed ? "approved"
          : exact.blockCode === "CAPABILITY_REVOKED" ? "revoked"
          : exact.blockCode === "CAPABILITY_QUARANTINED" ? "quarantined"
          : "permission_blocked";
        if (!exact.activationAllowed) next = exact.replacement
          ? `Remove this pin and review replacement ${exact.replacement.ref}@${exact.replacement.version} (${exact.replacement.artifactDigest}).`
          : "Remove this pin and request an approved replacement.";
      }
    } catch (error) {
      if (error instanceof SuperSkillCliError && (error.reasonCode === "REQUEST_CANCELLED" || error.reasonCode === "REQUEST_TIMEOUT")) throw error;
      if (error instanceof SuperSkillCliError && error.reasonCode === "MANAGED_FILE_CHANGED") status = "changed";
      else status = "unavailable";
      next = error instanceof Error ? error.message : String(error);
    }
    managed.push({ activationId: record.activationId, capability: record.capability, marker: record.pinned!.markerPath, status, next });
  }
  const status = plugin.status === "healthy" && !inventory.conflicts && managed.every((item) => item.status === "detected_on_disk" || item.status === "approved") ? "healthy" : "attention";
  return { status, client, plugin, inventory, managed };
}

type HarnessPlanManifest = {
  agents?: Array<{ id: string; prompt: string }>;
  workflow?: { stages?: Array<{ id: string; agent: string }> };
  examples?: Array<{ input?: string; output?: string }>;
};

function buildActivationPlan(root: string, manifest: HarnessPlanManifest): ActivationPlan {
  const agents = new Map((manifest.agents ?? []).map((agent) => [agent.id, safeArtifactRelative(agent.prompt)]));
  const stages = (manifest.workflow?.stages ?? []).map((stage) => {
    const promptPath = agents.get(stage.agent);
    if (!promptPath) throw invalid(`Workflow stage ${stage.id} has no agent prompt.`, "ARTIFACT_NOT_IMMUTABLE");
    const file = path.resolve(root, promptPath);
    assertInside(root, file);
    if (!existsSync(file) || lstatSync(file).isSymbolicLink() || !statSync(file).isFile()) throw invalid(`Workflow prompt is missing: ${promptPath}.`, "ARTIFACT_NOT_IMMUTABLE");
    return { id: stage.id, agent: stage.agent, promptPath };
  });
  if (!stages.length) throw invalid("Managed instruction harness has no workflow stages.", "ARTIFACT_NOT_IMMUTABLE");
  const files: ActivationPlan["files"] = [...new Set(stages.map((stage) => stage.promptPath))].map((file) => ({ path: file, purpose: "agent_prompt" }));
  for (const example of manifest.examples ?? []) {
    for (const candidate of [example.input, example.output]) {
      if (!candidate) continue;
      const relative = safeArtifactRelative(candidate);
      if (existsSync(path.resolve(root, relative))) files.push({ path: relative, purpose: "example" });
    }
  }
  return { root, files, stages };
}

function relocatePlan(plan: ActivationPlan, oldRoot: string, newRoot: string): ActivationPlan {
  if (plan.root !== oldRoot) throw invalid("Activation plan root mismatch.", "ARTIFACT_NOT_IMMUTABLE");
  return { ...plan, root: newRoot };
}

function verifyCache(cacheRoot: string, files: Array<{ path: string; content: string; truncated?: boolean }>, digest: string): void {
  const marker = path.join(cacheRoot, ".superskill-cache.json");
  if (!existsSync(marker)) throw changedFile("Managed cache marker is missing.");
  let cached: { artifactDigest?: string; files?: string[] };
  try { cached = JSON.parse(readFileSync(marker, "utf8")); } catch { throw changedFile("Managed cache marker is corrupt."); }
  if (cached.artifactDigest !== digest || JSON.stringify(cached.files) !== JSON.stringify(files.map((file) => file.path))) throw changedFile("Managed cache metadata changed.");
  const actual = files.map((file) => {
    const disk = path.resolve(cacheRoot, safeArtifactRelative(file.path));
    assertInside(cacheRoot, disk);
    if (!existsSync(disk) || lstatSync(disk).isSymbolicLink() || !statSync(disk).isFile()) throw changedFile(`Managed cache file is missing: ${file.path}.`);
    return { path: file.path, content: readFileSync(disk, "utf8") };
  });
  if (computeArtifactDigest(actual) !== digest) throw changedFile("Managed cache digest changed.");
}

function assertExactCapability(capability: ManagedCapability, id: string, version: string, digest: string, client: SuperSkillClient): void {
  if (capability.id !== id || capability.release.version !== version) {
    throw new SuperSkillCliError("Exact managed release changed after consent.", 3, "CONSENT_STALE", "Request a new recommendation and review the disclosure again.");
  }
  if (capability.release.artifactDigest !== digest) {
    throw new SuperSkillCliError("Exact managed artifact digest changed after consent.", 3, "ARTIFACT_DIGEST_MISMATCH", "Request a new recommendation; do not use this artifact.");
  }
  if (capability.release.delivery !== "free_archive") throw new SuperSkillCliError("Paid delivery is not supported by SuperSkill MVP.", 3, "PAYMENT_NOT_SUPPORTED_IN_SUPERSKILL", "Use the legacy explicit checkout/install flow outside SuperSkill.");
  if (capability.trust.status !== "approved") throw blockedRelease(capability.trust.status === "revoked" ? "CAPABILITY_REVOKED" : "CAPABILITY_QUARANTINED");
  if (!capability.compatibility.some((entry) => entry.client === client && entry.status !== "blocked")) throw invalid("Exact release is not compatible with the selected client.", "CLIENT_UNSUPPORTED");
}

function assertSameRequest(record: ActivationRecord, tuple: ActivationRecord["capability"], client: SuperSkillClient, recommendationId?: string): void {
  const same = record.capability.id === tuple.id
    && record.capability.version === tuple.version
    && record.capability.artifactDigest === tuple.artifactDigest
    && record.client === client
    && record.recommendationId === recommendationId;
  if (!same) throw collision("Activation request ID was already used for a different consent tuple.");
}

function startResult(state: ProjectState, record: ActivationRecord): Record<string, unknown> {
  const plan = readActivationPlan(state, record.activationId);
  if (record.mode === "temporary") assertTemporaryPlanRoot(state, record, plan);
  else {
    if (!record.sourceMarkerPath) throw invalid("Pinned activation source marker is missing.", "ACTIVATION_STATE_CORRUPT");
    const markerFile = path.resolve(state.projectRoot, record.sourceMarkerPath);
    assertSafePathUnder(state.projectRoot, markerFile, "pinned activation plan");
    if (path.resolve(plan.root) !== path.dirname(markerFile)) throw invalid("Pinned activation plan root does not match its marker.", "ACTIVATION_STATE_CORRUPT");
  }
  return {
    activationId: record.activationId,
    executionState: record.executionState,
    pinState: record.pinState,
    mode: record.mode,
    client: record.client,
    capability: record.capability,
    plan
  };
}

function assertTemporaryPlanRoot(state: ProjectState, record: ActivationRecord, plan: ActivationPlan): void {
  const expected = path.join(state.stateRoot, "cache", "sha256", record.capability.artifactDigest.slice("sha256:".length));
  if (path.resolve(plan.root) !== expected) throw invalid("Temporary activation plan root does not match its verified digest cache.", "ACTIVATION_STATE_CORRUPT");
  assertSafeStatePath(state, plan.root);
}

function localStateResult(record: ActivationRecord): Record<string, unknown> {
  return { activationId: record.activationId, executionState: record.executionState, pinState: record.pinState, client: record.client, capability: record.capability };
}

function finishResult(record: ActivationRecord) {
  return { activationId: record.activationId, executionState: record.executionState, pinState: record.pinState, outcome: record.outcome! };
}

function keepResult(record: ActivationRecord, managedFiles: string[]) {
  return { executionState: record.executionState, pinState: "pinned" as const, client: record.client, managedFiles: managedFiles.map((file) => projectRelative(record.projectRoot, path.join(path.dirname(path.resolve(record.projectRoot, record.pinned!.markerPath)), file))), doctor: { status: "detected_on_disk" as const } };
}

function generatedPinnedSkill(record: ActivationRecord, capability: ManagedCapability, markerRelative: string, plan: ActivationPlan): string {
  const references = plan.files.map((file) => `- \`references/resource/${safeArtifactRelative(file.path)}\` (${file.purpose})`).join("\n");
  const limitations = capability.trust.limitations.length ? capability.trust.limitations.map((item) => `- ${item}`).join("\n") : "- No additional limitation text was supplied; recheck exact status before use.";
  return `---
name: superskill-${record.capability.id}
description: "Use ${capability.title} for ${record.capability.id.replaceAll("-", " ")} tasks after explicit activation consent and an online exact-release recheck."
---

# ${capability.title}

Managed exact release: \`${record.capability.ref}@${record.capability.version}\`
Artifact digest: \`${record.capability.artifactDigest}\`

## Mandatory lifecycle

1. Confirm Node.js/npm are available. If not, stop with \`LOCAL_CLI_UNAVAILABLE\`.
2. Create one random \`req_...\` ID for this turn and reuse it unchanged on retry.
3. Ask explicit activation consent; a previous general SuperSkill opt-in is not enough.
4. Run:

   \`npx --yes ${SUPERSKILL_RUNTIME.cliPackage}@${SUPERSKILL_RUNTIME.cliVersion} activation start --from-pinned ${markerRelative} --activation-request <req_id> --target ${record.client} --consent explicit --json\`

5. Do not proceed offline. Read only files returned in the activation plan.
6. Read \`activationId\` from the start result and run these commands with that exact ID:

   \`npx --yes ${SUPERSKILL_RUNTIME.cliPackage}@${SUPERSKILL_RUNTIME.cliVersion} activation mark <activation_id> --state loaded --json\`

   \`npx --yes ${SUPERSKILL_RUNTIME.cliPackage}@${SUPERSKILL_RUNTIME.cliVersion} activation mark <activation_id> --state invoked --json\`

7. Finish with the same exact ID and honest \`agent_reported\`, \`user_confirmed\`, or \`unknown\` evidence:

   \`npx --yes ${SUPERSKILL_RUNTIME.cliPackage}@${SUPERSKILL_RUNTIME.cliVersion} activation finish <activation_id> --outcome <success|failed|unknown> --evidence <agent_reported|user_confirmed|unknown> --json\`

Agent-reported success is not verified business outcome. Never report \`success\` with \`unknown\` evidence.

## Reviewed instruction files

${references}

## Declared permissions

\`\`\`json
${JSON.stringify(capability.permissions, null, 2)}
\`\`\`

## Limitations

${limitations}

Never print or persist \`HH_TOKEN\` or legacy \`HH_SUPERSKILL_TOKEN\`. Never auto-update or fall back to an unscanned resource.
`;
}

export function verifyPinnedPackage(root: string, marker: ManagedPinnedMarker): void {
  if (marker.cliPackage !== SUPERSKILL_RUNTIME.cliPackage || marker.cliVersion !== SUPERSKILL_RUNTIME.cliVersion) {
    throw changedFile("Pinned runtime contract differs from this CLI. Remove and create a fresh pin; in-place update is unsupported.");
  }
  if (packageDigest(marker.managedFiles) !== marker.packageDigest) throw changedFile("Pinned package digest metadata changed.");
  for (const [relativeInput, digest] of Object.entries(marker.managedFiles)) {
    const relative = safeArtifactRelative(relativeInput);
    const file = path.resolve(root, relative);
    assertInside(root, file);
    assertNoSymlinkAncestors(root, file);
    if (!existsSync(file) || lstatSync(file).isSymbolicLink() || !statSync(file).isFile() || sha256Digest(readFileSync(file)) !== digest) throw changedFile(`Pinned managed file changed: ${relative}.`);
  }
}

async function emitForRecord(registry: string, state: ProjectState, record: ActivationRecord, kind: ManagedEvent["kind"], extra: Partial<ManagedEvent> = {}): Promise<void> {
  await sendManagedEvent({ registry, state, event: managedEvent(record, kind, extra) });
}

function queueLifecycleEvents(state: ProjectState, record: ActivationRecord, kinds: ManagedEvent["kind"][]): void {
  for (const kind of kinds) queueEvent(state, managedEvent(record, kind));
}

function managedEvent(record: ActivationRecord, kind: ManagedEvent["kind"], extra: Partial<ManagedEvent> = {}): ManagedEvent {
  const parts = record.capability.ref.split("/");
  return {
    eventId: deterministicEventId(record.activationId, kind, extra),
    kind,
    owner: parts[0],
    repo: parts.slice(1).join("/"),
    version: record.capability.version,
    target: record.client,
    client: record.client === "codex" ? "superskill-codex" : "superskill-claude",
    recommendationId: record.recommendationId,
    activationId: record.activationId,
    mode: record.mode,
    ...extra
  };
}

function deterministicEventId(activationId: string, kind: string, extra: Partial<ManagedEvent>): string {
  const identity = JSON.stringify({ activationId, kind, evidence: extra.evidence ?? null, outcome: extra.outcome ?? null, reasonCode: extra.reasonCode ?? null });
  return `evt_${createHash("sha256").update(identity).digest("base64url").slice(0, 24)}`;
}

function safeArtifactRelative(value: string): string {
  if (!value || value.includes("\\") || value.includes("\0") || path.posix.isAbsolute(value) || value.normalize("NFC") !== value || value.split("/").some((part) => !part || part === "." || part === "..")) {
    throw invalid(`Unsafe managed relative path: ${JSON.stringify(value)}.`, "MANAGED_FILE_CHANGED");
  }
  return value;
}

function safeRelativeMarker(value: string): string {
  const relative = safeArtifactRelative(value);
  if (path.posix.basename(relative) !== ".superskill-managed.json") throw invalid("Marker must name .superskill-managed.json.", "MANAGED_FILE_CHANGED");
  return relative;
}

function projectRelative(root: string, file: string): string {
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw invalid("Managed path is outside the project.", "MANAGED_FILE_CHANGED");
  return relative.split(path.sep).join("/");
}

function assertInside(root: string, file: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw invalid("Managed path resolves outside its owned root.", "MANAGED_FILE_CHANGED");
}

function assertNoSymlinkAncestors(root: string, file: string): void {
  const resolvedRoot = path.resolve(root);
  let cursor = path.resolve(file);
  assertInside(resolvedRoot, cursor);
  while (cursor !== resolvedRoot) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw changedFile("Managed path contains a symlink.");
    cursor = path.dirname(cursor);
  }
}

function removeEmptyDirectories(start: string, stop: string): void {
  let cursor = start;
  const resolvedStop = path.resolve(stop);
  while (cursor.startsWith(resolvedStop) && cursor !== resolvedStop) {
    try { rmdirSync(cursor); } catch { break; }
    cursor = path.dirname(cursor);
  }
}

function isExecutionState(value: string): value is ExecutionState {
  return ["accepted", "downloading", "digest_verified", "ready", "loaded", "invoked", "outcome_success", "outcome_failed", "outcome_unknown", "failed"].includes(value);
}

function isOutcomeState(value: ExecutionState): boolean {
  return value === "outcome_success" || value === "outcome_failed" || value === "outcome_unknown";
}

function writeResult(value: unknown, json: boolean, text: string): void {
  process.stdout.write(json ? `${JSON.stringify(value, null, 2)}\n` : `${text}\n`);
}

function invalid(message: string, reasonCode: string): SuperSkillCliError {
  return new SuperSkillCliError(message, 3, reasonCode, "Review the exact command contract and retry safely.");
}

function invalidTransition(from: string, to: string): SuperSkillCliError {
  return new SuperSkillCliError(`Invalid activation transition: ${from} -> ${to}.`, 3, "ACTIVATION_INVALID_TRANSITION", "Use loaded -> invoked -> outcome, without skipping or reversing states.");
}

function consentRequired(message: string): SuperSkillCliError {
  return new SuperSkillCliError(message, 3, "CONSENT_REQUIRED", "Show the exact disclosure and ask for separate explicit consent.");
}

function staleConsent(): SuperSkillCliError {
  return new SuperSkillCliError("Recommendation consent is expired or does not match the exact release.", 3, "CONSENT_STALE", "Request a new recommendation and disclosure.");
}

function collision(message: string): SuperSkillCliError {
  return new SuperSkillCliError(message, 3, "TARGET_COLLISION", "Do not overwrite it; use a new request or remove the owned managed pin safely.");
}

function changedFile(message: string): SuperSkillCliError {
  return new SuperSkillCliError(message, 3, "MANAGED_FILE_CHANGED", "No further files were changed. Review the package and clean up manually if ownership cannot be restored.");
}

function blockedRelease(code?: string, replacement?: { ref: string; version: string; artifactDigest: string }): SuperSkillCliError {
  const reason = managedBlockReason(code);
  const state = reason === "CAPABILITY_REVOKED" ? "revoked"
    : reason === "CAPABILITY_QUARANTINED" ? "quarantined"
    : "not currently eligible for managed activation";
  const next = replacement
    ? `Do not activate it; review replacement ${replacement.ref}@${replacement.version} (${replacement.artifactDigest}).`
    : reason === "PERMISSION_BLOCKED"
    ? "Do not activate it; request a fresh recommendation after its evidence or permissions are reviewed."
    : "Do not activate it; request a fresh approved replacement.";
  return new SuperSkillCliError(`Exact release is ${state}.`, 3, reason, next);
}

export function managedBlockReason(code?: string): "CAPABILITY_REVOKED" | "CAPABILITY_QUARANTINED" | "PERMISSION_BLOCKED" {
  if (code === "CAPABILITY_REVOKED" || code === "CAPABILITY_QUARANTINED") return code;
  return "PERMISSION_BLOCKED";
}
