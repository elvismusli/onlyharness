import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import {
  managedCapabilityIndexSchema,
  type Client,
  type ManagedCapability,
  type ManagedCapabilityIndex
} from "@harnesshub/capability-schema/browser";
import { ManagedCatalog } from "../apps/harness-api/src/capabilities.js";
import { MANAGED_EVENT_KINDS, recordManagedEvent } from "../apps/harness-api/src/events.js";
import { buildManagedArchive, type ManagedArchivePayload } from "../apps/harness-api/src/managed-archive.js";
import { registerSuperskillRoutes, superskillAuthFromHeader } from "../apps/harness-api/src/routes/superskill.js";
import {
  claudeCompatibilitySessionEligible,
  EXACT_ACTIVATION_EVENT_CHAIN,
  inspectCodexActivationToolTrace,
  inspectExactActivationEventChain
} from "./superskill-exact-evidence.js";
import { deriveCuratedSmokeTask } from "./superskill-smoke-task.js";
import { loadPrivateReviewFixtureForSmoke, type LoadedPrivateReviewFixture } from "./prepare-superskill-review-fixture.js";

const root = path.resolve(import.meta.dirname, "..");
const cliFile = path.join(root, "packages/harness-cli/dist/hh.mjs");
const indexFile = path.join(root, "data/superskill/index.json");
const curatedFile = path.join(root, "data/superskill/curated.json");
const historyFile = path.join(root, "data/superskill/history.json");
const reviewsRoot = path.join(root, "data/superskill/reviews");
const cliPackageFile = path.join(root, "packages/harness-cli/package.json");
const defaultExpected = {
  id: "deep-market-researcher",
  ref: "harnesses/deep-market-researcher",
  version: "0.2.1",
  artifactDigest: "sha256:9ebad5b23017dc95b758a77361080f026832538903735cdcb7d9a669f204927e"
} as const;
const defaultTaskSummary = "competitor research market map source-backed comparison";
const cliVersion = "0.2.13";
const smokeArguments = parseArguments(process.argv.slice(2));
const realClientSessionsRequested = smokeArguments.realClientSessions;
const realClientFilter = smokeArguments.realClient;
if (realClientFilter && !realClientSessionsRequested) {
  throw new Error("--real-client requires --real-client-sessions");
}
if (smokeArguments.evidenceOut && (!realClientSessionsRequested || realClientFilter)) {
  throw new Error("--evidence-out requires unfiltered --real-client-sessions so both clients are evidenced");
}
if (smokeArguments.privateFixture
  && (!smokeArguments.capabilityId || !smokeArguments.version || !smokeArguments.digest)) {
  throw new Error("--private-fixture requires --capability-id, --version and --digest");
}
const originalIndex = managedCapabilityIndexSchema.parse(JSON.parse(readFileSync(indexFile, "utf8")));
const requestedCapabilityId = smokeArguments.capabilityId ?? defaultExpected.id;
assertCapabilityId(requestedCapabilityId);
const publicCandidate = originalIndex.capabilities.find((capability) => capability.id === requestedCapabilityId);
assert.ok(publicCandidate, `Missing ${requestedCapabilityId} from checked-in SuperSkill index`);
assert.equal(publicCandidate.trust.status, "candidate", "Bootstrap smoke must begin from the honest checked-in candidate state");
const privateFixture = smokeArguments.privateFixture
  ? loadPrivateReviewFixtureForSmoke({
      id: requestedCapabilityId,
      from: publicCandidate.release.version,
      to: smokeArguments.version!,
      expectedDigest: smokeArguments.digest!
    })
  : undefined;
const exactCandidate = privateFixture ? privateCapability(publicCandidate, privateFixture) : publicCandidate;
const expected = resolveExpectedTuple(exactCandidate, smokeArguments);
const taskSummary = resolveTaskSummary(expected, smokeArguments.taskSummary, publicCandidate, Boolean(privateFixture));
const exactSnapshotFile = privateFixture
  ? path.join(root, ".onlyharness/private-review-fixtures", expected.id, `${expected.version}.json`)
  : path.join(root, "data/harness-versions", expected.ref, `${expected.version}.json`);
assert.ok(existsSync(exactSnapshotFile), `Missing immutable snapshot for ${expected.ref}@${expected.version}`);
const evidenceDirectory = path.join(root, "docs/plans/superskill-mvp/evidence");
const evidenceOutFile = smokeArguments.evidenceOut
  ? resolveEvidenceOutput(smokeArguments.evidenceOut, expected.id, expected.version)
  : undefined;
const realClientSessionTimeoutMs = 180_000;

type CliResult = Record<string, unknown>;
type RecommendationResult = CliResult & {
  recommendationId: string;
  decisionDigest: string;
  decision: string;
  expiresAt: string;
  selected: { capability: ManagedCapability };
};

const sourceTruthBefore = sourceTruthHashes();
assert.ok(existsSync(cliFile), "Build packages/harness-cli/dist/hh.mjs before running this smoke");
assert.equal((JSON.parse(readFileSync(cliPackageFile, "utf8")) as { version?: string }).version, cliVersion);

assertExactTuple(exactCandidate);
const exactArchiveBuilder = privateFixture ? privateArchiveBuilder(privateFixture) : buildManagedArchive;
const exactArchive = exactArchiveBuilder(exactCandidate);
assert.equal(exactArchive.artifactDigest, expected.artifactDigest);
assert.ok(exactArchive.totalFileCount > 0, "Exact archive must contain at least one file");
assert.equal(exactArchive.files.length, exactArchive.totalFileCount);
assert.equal(exactArchive.archiveTruncated, false);
assert.ok(exactArchive.files.every((file) => file.truncated === false));

const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "superskill-exact-release-"));
const fixtureRoot = path.join(temporaryRoot, "fixture");
const projectsRoot = path.join(temporaryRoot, "projects");
const isolatedHome = path.join(temporaryRoot, "home");
const overlayIndexFile = path.join(fixtureRoot, "index.json");
const overlayHistoryFile = path.join(fixtureRoot, "history.json");
const eventsFile = path.join(fixtureRoot, "events.jsonl");
const token = `bootstrap_${randomBytes(32).toString("base64url")}`;
const tokenHash = createHash("sha256").update(token).digest("hex");
const telemetrySalt = randomBytes(32).toString("hex");
const now = new Date();
const checkedAt = now.toISOString();
const expiresAt = new Date(now.getTime() + 7 * 86_400_000).toISOString();
const overlay = eligibleBootstrapOverlay(originalIndex, exactCandidate, checkedAt, expiresAt);

mkdirSync(fixtureRoot, { recursive: true });
mkdirSync(projectsRoot, { recursive: true });
mkdirSync(isolatedHome, { recursive: true });
writeFileSync(overlayIndexFile, `${JSON.stringify(overlay, null, 2)}\n`, { mode: 0o600 });
writeFileSync(overlayHistoryFile, `${JSON.stringify({ schemaVersion: "superskill.history.v1", generatedAt: checkedAt, capabilities: [] }, null, 2)}\n`, { mode: 0o600 });

const app = Fastify({ logger: false });
await app.register(async (managed) => {
  await registerSuperskillRoutes(managed, {
    catalog: new ManagedCatalog({ indexPath: overlayIndexFile, historyPath: overlayHistoryFile }),
    enabled: true,
    tokenHashes: [tokenHash],
    telemetrySalt,
    archiveBuilder: exactArchiveBuilder
  });
  managed.post("/events", async (request, reply) => {
    const authorization = Array.isArray(request.headers.authorization) ? request.headers.authorization[0] : request.headers.authorization;
    const auth = superskillAuthFromHeader(authorization, { tokenHashes: [tokenHash], telemetrySalt });
    if (!auth.ok) return reply.code(auth.status).send({ error: "Managed event access denied", code: auth.reasonCode });
    const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
    const kind = typeof body.kind === "string" ? body.kind : "";
    if (!(MANAGED_EVENT_KINDS as readonly string[]).includes(kind)) return reply.code(400).send({ error: "Invalid managed event" });
    const result = await recordManagedEvent({
      kind,
      eventId: stringValue(body.eventId),
      owner: stringValue(body.owner),
      repo: stringValue(body.repo),
      version: stringValue(body.version),
      target: stringValue(body.target),
      client: stringValue(body.client),
      recommendationId: stringValue(body.recommendationId),
      activationId: stringValue(body.activationId),
      mode: stringValue(body.mode),
      evidence: stringValue(body.evidence),
      outcome: stringValue(body.outcome),
      reasonCode: stringValue(body.reasonCode),
      subject: auth.subject
    }, { localPath: eventsFile });
    if (!result.recorded && !result.duplicate) return reply.code(400).send({ error: "Invalid managed event" });
    return reply.code(200).send(result);
  });
}, { prefix: "/api" });

let registry = "";
const clientReports: Array<Record<string, unknown>> = [];
try {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address !== "string", "Bootstrap API did not bind a TCP port");
  registry = `http://127.0.0.1:${address.port}/api`;

  for (const client of ["claude-code", "codex"] as const) {
    clientReports.push(await smokeClient(client));
  }

  const eventsText = existsSync(eventsFile) ? readFileSync(eventsFile, "utf8") : "";
  assert.ok(eventsText, "Expected managed lifecycle events");
  assert.equal(eventsText.includes(token), false, "Token leaked into managed events");
  assert.equal(eventsText.includes(taskSummary), false, "Task summary leaked into managed events");
  assert.equal(eventsText.includes(temporaryRoot), false, "Absolute temporary path leaked into managed events");

  const sourceTruthAfter = sourceTruthHashes();
  assert.deepEqual(sourceTruthAfter, sourceTruthBefore, "Checked-in catalog or review truth changed during bootstrap smoke");

  const eligibleReports = clientReports.filter((item) => !realClientFilter || item.client === realClientFilter);
  const allEligible = realClientSessionsRequested
    && eligibleReports.length > 0
    && eligibleReports.every((item) => item.compatibilitySessionEligible === true);
  const report = {
    schemaVersion: "superskill.exact-release-bootstrap-smoke.v1",
    bootstrapOnly: true,
    promotionAuthorized: false,
    attestationCreated: false,
    humanReviewEvidence: false,
    sourceTruthUnchanged: true,
    release: expected,
    fixtureInput: privateFixture ? {
      mode: "private_ignored_snapshot",
      visibility: "private_candidate",
      status: privateFixture.snapshot.status,
      expiresAt: privateFixture.snapshot.expiresAt,
      packetBound: true,
      publicTruthMutation: false,
      privatePathIncluded: false
    } : {
      mode: "public_catalog_snapshot",
      publicTruthMutation: false
    },
    archive: {
      totalFileCount: exactArchive.totalFileCount,
      complete: exactArchive.files.length === exactArchive.totalFileCount,
      truncated: exactArchive.archiveTruncated
    },
    runtime: {
      cli: `onlyharness@${cliVersion}`,
      api: "registerSuperskillRoutes+buildManagedArchive",
      routePrefix: "/api"
    },
    realClientSessions: {
      requested: realClientSessionsRequested,
      filter: realClientFilter ?? "both",
      allEligible,
      attemptPolicy: "one bounded fresh session per client; failures stay ineligible"
    },
    clients: clientReports,
    privacy: {
      tokenPersistedInProjectOrEvents: false,
      taskPersistedInProjectOrEvents: false,
      absolutePathIncludedInPublicReportOrEvents: false
    },
    outcomePolicy: "No real capability task was executed; both activation outcomes are unknown with unknown evidence.",
    nextGate: "Human review and a valid exact-release attestation are still required before promotion."
  };
  const publicJson = JSON.stringify(report, null, 2);
  assert.equal(publicJson.includes(token), false);
  assert.equal(publicJson.includes(taskSummary), false);
  assert.equal(publicJson.includes(root), false);
  assert.equal(publicJson.includes(temporaryRoot), false);
  if (privateFixture) assert.equal(publicJson.includes(privateChallengeValue(privateFixture)), false);
  assert.equal(/\/(?:Users|home|private|tmp)\//.test(publicJson), false);
  process.stdout.write(`${publicJson}\n`);
  if (evidenceOutFile) {
    assert.equal(allEligible, true, "Durable evidence cannot be written unless both real client sessions pass");
    writeFileSync(evidenceOutFile, `${publicJson}\n`, { mode: 0o644 });
  }
  if (realClientSessionsRequested && eligibleReports.some((item) => item.compatibilitySessionEligible !== true)) {
    process.exitCode = 1;
  }
} finally {
  await app.close();
  rmSync(temporaryRoot, { recursive: true, force: true });
}

async function smokeClient(client: Client): Promise<Record<string, unknown>> {
  const projectInput = path.join(projectsRoot, client);
  mkdirSync(projectInput, { recursive: true });
  const project = realpathSync(projectInput);
  await runProcess("git", ["init", "-q"], { cwd: project });
  const sentinel = path.join(project, "unrelated-sentinel.txt");
  writeFileSync(sentinel, "must remain\n");
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: isolatedHome,
    HH_REGISTRY_URL: registry,
    HH_SUPERSKILL_TOKEN: token,
    HH_SUPERSKILL_TELEMETRY: "on",
    HH_SUPERSKILL_DOCTOR_SKIP_NPM_VIEW: "1"
  };
  delete childEnv.ONLYHARNESS_STATE_DIR;
  const clientBinaryVersion = await observeClientVersion(client, childEnv);

  const recommendation = await runCli([
    "recommend", taskSummary,
    "--target", client,
    "--project-dir", project,
    "--json"
  ], childEnv) as RecommendationResult;
  assert.equal(recommendation.decision, "recommend");
  assert.equal(recommendation.selected.capability.id, expected.id);
  assertExactTuple(recommendation.selected.capability);

  const requestId = `req_bootstrap_${client.replace("-", "")}_${randomBytes(8).toString("base64url")}`;
  const startArgs = [
    "activation", "start", expected.id,
    "--version", expected.version,
    "--digest", expected.artifactDigest,
    "--recommendation", recommendation.recommendationId,
    "--decision-digest", recommendation.decisionDigest,
    "--recommendation-expires-at", recommendation.expiresAt,
    "--activation-request", requestId,
    "--target", client,
    "--mode", "temporary",
    "--consent", "explicit",
    "--project-dir", project,
    "--json"
  ];
  const started = await runCli(startArgs, childEnv) as CliResult & {
    activationId: string;
    executionState: string;
    pinState: string;
    mode: string;
    plan: { root: string };
  };
  assert.equal(started.executionState, "ready");
  assert.equal(started.pinState, "none");
  assert.equal(started.mode, "temporary");
  assert.ok(path.resolve(started.plan.root).startsWith(path.join(project, ".onlyharness", "cache", "sha256")));
  assert.equal(existsSync(nativePinRoot(project, client)), false, "Temporary activation wrote a native pin");
  assert.equal(existsSync(path.join(project, ".codex", "harnesses")), false, "Legacy Codex harness path was created");

  const retry = await runCli(startArgs, childEnv) as typeof started;
  assert.equal(retry.activationId, started.activationId, "Same request ID did not resume the same activation");
  assert.equal(retry.plan.root, started.plan.root, "Same request ID did not reuse the same digest cache");

  const loaded = await runCli([
    "activation", "mark", started.activationId,
    "--state", "loaded", "--project-dir", project, "--json"
  ], childEnv);
  assert.equal(loaded.executionState, "loaded");
  const invoked = await runCli([
    "activation", "mark", started.activationId,
    "--state", "invoked", "--project-dir", project, "--json"
  ], childEnv);
  assert.equal(invoked.executionState, "invoked");
  const finished = await runCli([
    "activation", "finish", started.activationId,
    "--outcome", "unknown", "--evidence", "unknown",
    "--project-dir", project, "--json"
  ], childEnv) as CliResult & { executionState: string; outcome: { value: string; evidence: string } };
  assert.equal(finished.executionState, "outcome_unknown");
  assert.deepEqual(finished.outcome, { value: "unknown", evidence: "unknown" });

  const kept = await runCli([
    "activation", "keep", started.activationId,
    "--confirm-keep", "--project-dir", project, "--json"
  ], childEnv) as CliResult & { pinState: string; doctor: { status: string } };
  assert.equal(kept.pinState, "pinned");
  assert.equal(kept.doctor.status, "detected_on_disk");
  const markerRelative = nativeMarker(client);
  const markerFile = path.join(project, markerRelative);
  assert.ok(existsSync(markerFile), `Missing exact native marker ${markerRelative}`);
  const marker = JSON.parse(readFileSync(markerFile, "utf8")) as Record<string, unknown>;
  assert.equal(marker.capabilityId, expected.id);
  assert.equal(marker.ref, expected.ref);
  assert.equal(marker.version, expected.version);
  assert.equal(marker.artifactDigest, expected.artifactDigest);
  assert.equal(marker.cliVersion, cliVersion);
  assert.equal(existsSync(otherNativePinRoot(project, client)), false, "Activation wrote into the other client's native root");
  assert.equal(existsSync(path.join(project, ".codex", "harnesses")), false, "Legacy Codex harness path was created");

  const doctor = await runCli([
    "activation", "doctor", "--target", client, "--live",
    "--project-dir", project, "--json"
  ], childEnv) as CliResult & {
    inventory: { managedSkills: number; installedManagedRefs: Array<{ ref: string; version: string; artifactDigest: string }> };
    managed: Array<{ status: string; capability: { id: string; ref: string; version: string; artifactDigest: string } }>;
  };
  assert.equal(doctor.inventory.managedSkills, 1);
  assert.deepEqual(doctor.inventory.installedManagedRefs, [{ ref: expected.ref, version: expected.version, artifactDigest: expected.artifactDigest }]);
  assert.equal(doctor.managed.length, 1);
  assert.equal(doctor.managed[0]?.status, "approved");
  assert.deepEqual(doctor.managed[0]?.capability, expected);

  const pinned = await runCli([
    "activation", "start",
    "--from-pinned", markerRelative,
    "--activation-request", `req_pinned_${client.replace("-", "")}_${randomBytes(8).toString("base64url")}`,
    "--target", client,
    "--mode", "pinned",
    "--consent", "explicit",
    "--project-dir", project,
    "--json"
  ], childEnv) as CliResult & { executionState: string; mode: string; capability: Record<string, unknown> };
  assert.equal(pinned.executionState, "ready");
  assert.equal(pinned.mode, "pinned");
  assert.deepEqual(pinned.capability, expected);

  const realSession = realClientSessionsRequested && (!realClientFilter || realClientFilter === client)
    ? await runRealClientSession(client, project, markerRelative, childEnv, clientBinaryVersion)
    : {
        status: "not_run",
        compatibilitySessionEligible: false,
        blocker: realClientSessionsRequested ? "FILTERED_OUT" : "OPT_IN_NOT_REQUESTED",
        sessionPersistence: client === "claude-code" ? "disabled" : "ephemeral",
        stateEvidence: false,
        eventEvidence: false
      };

  const removed = await runCli([
    "activation", "remove",
    "--marker", markerRelative,
    "--confirm-remove",
    "--project-dir", project,
    "--json"
  ], childEnv) as CliResult & { pinState: string; alreadyRemoved: boolean };
  assert.equal(removed.pinState, "removed");
  assert.equal(removed.alreadyRemoved, false);
  assert.equal(existsSync(markerFile), false, "Managed marker survived removal");
  assert.deepEqual(listFiles(path.dirname(markerFile)), [], "Managed files survived removal");
  assert.equal(existsSync(path.join(project, ".codex", "harnesses")), false, "Legacy Codex harness path was created");
  assert.equal(readFileSync(sentinel, "utf8"), "must remain\n", "Removal changed an unrelated file");

  const projectText = readTextTree(project);
  assert.equal(projectText.includes(token), false, "Token leaked into local project state");
  assert.equal(projectText.includes(taskSummary), false, "Task summary leaked into local project state");
  const pendingEventsFile = path.join(project, ".onlyharness", "events-pending.jsonl");
  assert.ok(existsSync(pendingEventsFile), "Offline-safe removal event was not queued");
  const pendingEvents = readFileSync(pendingEventsFile, "utf8");
  assert.match(pendingEvents, /"kind":"activation_removed"/);
  assert.equal(pendingEvents.includes(token), false);
  assert.equal(pendingEvents.includes(taskSummary), false);
  assert.equal(pendingEvents.includes(project), false);

  return {
    client,
    realClientSession: realSession.status,
    compatibilitySessionEligible: realSession.compatibilitySessionEligible,
    compatibilityEvidenceEligible: realSession.compatibilitySessionEligible,
    compatibilityAttestationEligible: realSession.compatibilitySessionEligible,
    clientBinaryVersionObservedOnly: clientBinaryVersion,
    realClientEvidence: realSession,
    lifecycle: ["recommend", "start", "resume", "loaded", "invoked", "finish_unknown", "keep", "doctor_live", "pinned_reuse", "remove"],
    temporaryCacheReused: true,
    nativeMarker: markerRelative,
    legacyCodexHarnessesCreated: false,
    doctorExactReleaseStatus: "approved_in_bootstrap_overlay",
    pinnedReuse: "ready",
    outcome: { value: "unknown", evidence: "unknown" },
    removal: "owned_files_removed_unrelated_file_preserved",
    removalEvent: "queued_locally_for_offline_safe_flush"
  };
}

async function runRealClientSession(
  client: Client,
  project: string,
  markerRelative: string,
  cliEnv: NodeJS.ProcessEnv,
  observedVersion: string
): Promise<Record<string, unknown> & { status: string; compatibilitySessionEligible: boolean }> {
  const sessionStartedAt = new Date().toISOString();
  const expectedVersion = client === "claude-code" ? "2.1.112" : "0.135.0";
  if (!observedVersion.includes(expectedVersion)) {
    return realClientFailure("not_run", "CLIENT_VERSION_MISMATCH", client);
  }

  const requestId = `req_clientsession_${client.replace("-", "")}_${randomBytes(8).toString("base64url")}`;
  const skillRelative = markerRelative.replace("/.superskill-managed.json", "/SKILL.md");
  const codexStartCommand = `npx --yes onlyharness@${cliVersion} activation start --from-pinned ${markerRelative} --activation-request ${requestId} --target codex --consent explicit --json`;
  const prompt = [
    ...(client === "claude-code" ? [`/superskill-${expected.id}`] : []),
    "Run one disposable exact-release compatibility session.",
    `Use the project-local skill named superskill-${expected.id}.`,
    ...(client === "claude-code" ? [
      `Your first action must be an actual Skill tool call for exactly superskill-${expected.id}; do not imitate, summarize, or skip the skill.`
    ] : []),
    `I explicitly consent to activate ${expected.ref}@${expected.version} with digest ${expected.artifactDigest} for this session only.`,
    `Use activation request id ${requestId}.`,
    "Discover and follow the pinned skill's mandatory lifecycle yourself through loaded, invoked, then finish with outcome unknown and evidence unknown.",
    ...(client === "codex" ? [`Before the lifecycle, run exactly: cat -- ${skillRelative}`] : []),
    ...(client === "codex" ? [
      `Then run exactly: ${codexStartCommand}`,
      "Read activationId directly from that command's JSON tool result. Do not run a parser, assignment, pwd, ls, find, grep, or any other helper command.",
      "Substitute that exact activationId, never a literal placeholder, and run exactly these three commands in order:",
      `npx --yes onlyharness@${cliVersion} activation mark ACTIVATION_ID_FROM_START_JSON --state loaded --json`,
      `npx --yes onlyharness@${cliVersion} activation mark ACTIVATION_ID_FROM_START_JSON --state invoked --json`,
      `npx --yes onlyharness@${cliVersion} activation finish ACTIVATION_ID_FROM_START_JSON --outcome unknown --evidence unknown --json`
    ] : []),
    `Running the exact npx --yes onlyharness@${cliVersion} activation commands from the pinned skill is required and explicitly allowed.`,
    client === "codex"
      ? "The exact cat command above is the only non-activation shell command allowed; do not compose commands or run discovery helpers."
      : "Run no other Bash command.",
    "Do not perform the requested capability task, keep, remove, update, inspect environment variables, or print tokens or absolute paths.",
    "Do not answer until every required activation command has completed successfully. Then reply only: lifecycle complete."
  // Claude Code treats a user-invoked /skill plus arguments as one command line.
  // Keeping the slash command on a separate line makes discovery model-dependent.
  ].join(client === "claude-code" ? " " : "\n");
  const sessionEnv: NodeJS.ProcessEnv = allowlistedClientSessionEnvironment({
    HH_REGISTRY_URL: cliEnv.HH_REGISTRY_URL,
    HH_SUPERSKILL_TOKEN: cliEnv.HH_SUPERSKILL_TOKEN,
    HH_SUPERSKILL_TELEMETRY: "on",
    HH_SUPERSKILL_DOCTOR_SKIP_NPM_VIEW: "1"
  });
  const clientNpmCache = path.join(project, ".onlyharness", "client-npm-cache");
  const clientNpmConfig = path.join(project, ".onlyharness", "client-npm-config");
  mkdirSync(clientNpmCache, { recursive: true });
  mkdirSync(clientNpmConfig, { recursive: true });
  const npmUserConfig = path.join(clientNpmConfig, "user.npmrc");
  const npmGlobalConfig = path.join(clientNpmConfig, "global.npmrc");
  writeFileSync(npmUserConfig, "", { mode: 0o600 });
  writeFileSync(npmGlobalConfig, "", { mode: 0o600 });
  sessionEnv.NPM_CONFIG_CACHE = clientNpmCache;
  sessionEnv.NPM_CONFIG_USERCONFIG = npmUserConfig;
  sessionEnv.NPM_CONFIG_GLOBALCONFIG = npmGlobalConfig;
  sessionEnv.NPM_CONFIG_UPDATE_NOTIFIER = "false";
  sessionEnv.NPM_CONFIG_FUND = "false";
  sessionEnv.NPM_CONFIG_AUDIT = "false";
  let codexConfigIsolated = false;
  if (client === "codex") {
    const home = process.env.HOME;
    if (!home) return realClientFailure("not_run", "CLIENT_AUTH_UNAVAILABLE", client);
    const authSource = path.join(home, ".codex", "auth.json");
    if (!existsSync(authSource)) return realClientFailure("not_run", "CLIENT_AUTH_UNAVAILABLE", client);
    const codexHome = path.join(temporaryRoot, "client-config", "codex");
    mkdirSync(codexHome, { recursive: true });
    symlinkSync(authSource, path.join(codexHome, "auth.json"));
    sessionEnv.CODEX_HOME = codexHome;
    codexConfigIsolated = true;
  }
  const invocation = client === "claude-code"
    ? {
        command: "claude",
        args: [
          "--print",
          prompt,
          "--no-session-persistence",
          "--output-format", "stream-json",
          "--verbose",
          "--permission-mode", "dontAsk",
          "--setting-sources", "project",
          "--strict-mcp-config",
          "--mcp-config", '{"mcpServers":{}}',
          "--no-chrome",
          "--tools", "Skill", "Bash",
          "--allowedTools", "Skill", `Bash(npx --yes onlyharness@${cliVersion} activation *)`
        ]
      }
    : {
        command: "codex",
        args: [
          "exec",
          "--ephemeral",
          "--sandbox", "workspace-write",
          "--cd", project,
          "--ignore-user-config",
          "--ignore-rules",
          "--disable", "browser_use",
          "--disable", "apps",
          "--disable", "multi_agent",
          "-c", "sandbox_workspace_write.network_access=true",
          "--json",
          "-"
        ]
      };

  const result = await runBoundedClientProcess(invocation.command, invocation.args, {
    cwd: project,
    env: sessionEnv,
    timeoutMs: realClientSessionTimeoutMs,
    input: client === "claude-code" ? "" : prompt
  });
  rmSync(clientNpmCache, { recursive: true, force: true });
  rmSync(clientNpmConfig, { recursive: true, force: true });
  const combined = `${result.stdout}\n${result.stderr}`;
  if (combined.includes(token)) return realClientFailure("failed", "CLIENT_OUTPUT_TOKEN_LEAK", client);
  if (result.timedOut) return realClientFailure("failed", "CLIENT_SESSION_TIMEOUT", client);
  if (result.code !== 0) return realClientFailure("failed", classifyClientFailure(combined), client);

  const claudeSkillTraceObserved = client === "claude-code"
    ? claudeExactSkillToolObserved(result.stdout, `superskill-${expected.id}`)
    : false;
  const activationToolUsesObserved = client === "claude-code"
    ? claudeActivationBashToolUseCount(result.stdout)
    : undefined;
  const claudeTraceSummary = client === "claude-code"
    ? summarizeClaudeTrace(result.stdout)
    : undefined;
  const record = readActivationByRequest(project, requestId);
  const codexToolEvidence = client === "codex"
    ? inspectCodexActivationToolTrace(result.stdout, {
        cliVersion,
        requestId,
        activationId: typeof record?.activationId === "string" ? record.activationId : "act_missing_state",
        markerRelative,
        skillRelative
      })
    : undefined;
  if (!record) return realClientFailure("failed", "PINNED_ACTIVATION_STATE_MISSING", client, {
    skillTraceObserved: claudeSkillTraceObserved,
    ...(claudeTraceSummary === undefined ? {} : { claudeTraceSummary }),
    ...(codexToolEvidence === undefined ? {} : { codexToolEvidence }),
    ...(activationToolUsesObserved === undefined ? {} : { activationToolUsesObserved })
  });
  const skillTraceObserved = client === "claude-code"
    ? claudeSkillTraceObserved
    : codexConfigIsolated && codexToolEvidence?.skillLoadObserved === true && codexToolEvidence.valid;
  const stateEvidence = record.schemaVersion === "superskill.activation.v1"
    && record.activationRequestId === requestId
    && record.mode === "pinned"
    && record.sourceMarkerPath === markerRelative
    && record.client === client
    && record.executionState === "outcome_unknown"
    && record.pinState === "pinned"
    && record.outcome?.value === "unknown"
    && record.outcome?.evidence === "unknown"
    && record.capability?.id === expected.id
    && record.capability?.ref === expected.ref
    && record.capability?.version === expected.version
    && record.capability?.artifactDigest === expected.artifactDigest;
  const eventEvidence = readManagedEventEvidence(record.activationId);
  if (!stateEvidence) return realClientFailure("failed", "PINNED_ACTIVATION_STATE_INCOMPLETE", client, {
    eventEvidence,
    ...(codexToolEvidence === undefined ? {} : { codexToolEvidence })
  });
  if (!eventEvidence.valid) return realClientFailure("failed", "PINNED_ACTIVATION_EVENTS_INVALID", client, {
    stateEvidence,
    eventEvidence,
    ...(codexToolEvidence === undefined ? {} : { codexToolEvidence })
  });
  const skillDiscoveryEvidence = client === "claude-code"
    ? claudeCompatibilitySessionEligible({
        skillTraceObserved,
        stateEvidence,
        eventEvidenceValid: eventEvidence.valid
      })
      ? "skill_tool_call"
      : undefined
    : skillTraceObserved
      ? "exact_project_skill_read_plus_structured_successful_activation_commands"
      : undefined;
  if (!skillDiscoveryEvidence) return realClientFailure("failed", "PINNED_SKILL_DISCOVERY_NOT_OBSERVED", client, {
    stateEvidence,
    eventEvidence,
    ...(codexToolEvidence === undefined ? {} : { codexToolEvidence })
  });

  return {
    status: "passed",
    compatibilitySessionEligible: true,
    blocker: null,
    sessionPersistence: client === "claude-code" ? "disabled" : "ephemeral",
    sandbox: client === "claude-code" ? "restricted Skill+Bash allowlist" : "workspace-write; model tools disabled except local shell",
    clientVersion: expectedVersion,
    checkedAt: new Date().toISOString(),
    fixtureId: `${expected.id}-${expected.version}-real-${client}-v1`,
    sessionStartedAt,
    skillTraceObserved,
    skillDiscoveryEvidence,
    ...(codexToolEvidence === undefined ? {} : { codexToolEvidence }),
    stateEvidence: true,
    eventEvidence,
    lifecycle: [...EXACT_ACTIVATION_EVENT_CHAIN],
    outcome: { value: "unknown", evidence: "unknown" },
    publicOutputSanitized: true,
    configIsolation: client === "codex"
      ? "temporary CODEX_HOME with auth-only symlink; no user config, plugins, memories, or global skills"
      : "project settings only; session persistence disabled",
    environmentHandling: "explicit runtime allowlist plus empty temporary npm user/global configs; ambient credential and application variables are not inherited",
    authHandling: client === "codex"
      ? "existing auth used in place through an auth-only symlink; credential contents are not copied or read by smoke"
      : "existing client auth used in place; no credential files copied or read by smoke"
  };
}

function realClientFailure(
  status: "not_run" | "failed",
  blocker: string,
  client: Client,
  evidence: Record<string, unknown> = {}
): Record<string, unknown> & { status: string; compatibilitySessionEligible: false } {
  return {
    status,
    compatibilitySessionEligible: false,
    blocker,
    attemptedAt: new Date().toISOString(),
    sessionPersistence: client === "claude-code" ? "disabled" : "ephemeral",
    stateEvidence: false,
    eventEvidence: false,
    ...evidence
  };
}

function readActivationByRequest(project: string, requestId: string): Record<string, any> | undefined {
  const directory = path.join(project, ".onlyharness", "activations");
  for (const file of listFiles(directory)) {
    if (!file.endsWith(".json")) continue;
    try {
      const record = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
      if (record.activationRequestId === requestId) return record;
    } catch {
      // Corrupt state is treated as missing evidence.
    }
  }
  return undefined;
}

function readManagedEventEvidence(activationId: string) {
  const rows: Array<{ activation_id?: unknown; activationId?: unknown; kind?: unknown }> = [];
  if (!existsSync(eventsFile)) return inspectExactActivationEventChain(rows, activationId);
  for (const line of readFileSync(eventsFile, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as { activation_id?: unknown; activationId?: unknown; kind?: unknown });
    } catch {
      // Corrupt event rows cannot satisfy evidence.
    }
  }
  return inspectExactActivationEventChain(rows, activationId);
}

function allowlistedClientSessionEnvironment(managed: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "TERM",
    "CLAUDE_CONFIG_DIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME",
    "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS"
  ]) {
    if (process.env[key] !== undefined) result[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(managed)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function classifyClientFailure(output: string): string {
  if (/input must be provided|prompt.*required|unexpected argument/i.test(output)) return "CLIENT_INVOCATION_INPUT_INVALID";
  if (/output schema|response.?format|json schema|unsupported.*schema/i.test(output)) return "CLIENT_OUTPUT_SCHEMA_UNSUPPORTED";
  if (/unknown feature|unknown configuration|invalid configuration|config key/i.test(output)) return "CLIENT_INVOCATION_CONFIG_INVALID";
  if (/not logged in|authentication|authenticate|unauthorized|invalid api key|oauth/i.test(output)) return "CLIENT_AUTH_UNAVAILABLE";
  if (/rate.?limit|quota|usage limit|overloaded/i.test(output)) return "CLIENT_CAPACITY_UNAVAILABLE";
  if (/permission|denied|sandbox/i.test(output)) return "CLIENT_TOOL_PERMISSION_BLOCKED";
  if (/network|connection|fetch failed|econnrefused/i.test(output)) return "CLIENT_LOCAL_API_UNREACHABLE";
  return "CLIENT_PROCESS_FAILED";
}

async function runBoundedClientProcess(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; input: string }
): Promise<{ code: number | null; timedOut: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32"
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdin.end(options.input);
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, options.timeoutMs);
    child.once("error", () => {
      clearTimeout(timer);
      resolve({ code: null, timedOut, stdout, stderr });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut, stdout, stderr });
    });
  });
}

function claudeExactSkillToolObserved(output: string, skill: string): boolean {
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (containsExactSkillToolUse(event, skill)) return true;
    } catch {
      // Non-JSON output cannot prove a tool call.
    }
  }
  return false;
}

function summarizeClaudeTrace(output: string): {
  toolUseCount: number;
  toolNames: string[];
  textSignals: string[];
  textDigest: string;
} {
  const names: string[] = [];
  const text: string[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    try {
      collectClaudeTrace(JSON.parse(line), names, text);
    } catch {
      // Non-JSON output is not evidence and is intentionally not retained.
    }
  }
  const joined = text.join("\n");
  const signals = [
    [/unknown skill|skill.{0,40}(?:not found|unavailable|does not exist)/i, "skill_unavailable"],
    [/permission|not allowed|denied/i, "permission_blocked"],
    [/lifecycle complete/i, "lifecycle_complete_text"],
    [/cannot|can't|unable|refus/i, "refusal_or_inability"]
  ] as const;
  return {
    toolUseCount: names.length,
    toolNames: [...new Set(names)].sort(),
    textSignals: signals.filter(([pattern]) => pattern.test(joined)).map(([, label]) => label),
    textDigest: createHash("sha256").update(joined).digest("hex")
  };
}

function collectClaudeTrace(value: unknown, names: string[], text: string[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectClaudeTrace(item, names, text);
    return;
  }
  const record = value as Record<string, unknown>;
  if (record.type === "tool_use" && typeof record.name === "string") names.push(record.name);
  if ((record.type === "text" || record.type === "result") && typeof record.text === "string") text.push(record.text);
  if (record.type === "result" && typeof record.result === "string") text.push(record.result);
  for (const item of Object.values(record)) collectClaudeTrace(item, names, text);
}

function containsExactSkillToolUse(value: unknown, skill: string): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => containsExactSkillToolUse(item, skill));
  const record = value as Record<string, unknown>;
  if (record.type === "tool_use" && record.name === "Skill" && record.input && typeof record.input === "object") {
    const input = record.input as Record<string, unknown>;
    if (input.skill === skill || input.name === skill || input.command === skill) return true;
  }
  return Object.values(record).some((item) => containsExactSkillToolUse(item, skill));
}

function claudeActivationBashToolUseCount(output: string): number {
  let count = 0;
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    try {
      count += countActivationBashToolUses(JSON.parse(line));
    } catch {
      // Non-JSON output cannot prove a tool call.
    }
  }
  return count;
}

function countActivationBashToolUses(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countActivationBashToolUses(item), 0);
  const record = value as Record<string, unknown>;
  let own = 0;
  if (record.type === "tool_use" && record.name === "Bash" && record.input && typeof record.input === "object") {
    const command = (record.input as Record<string, unknown>).command;
    if (typeof command === "string" && command.includes(`onlyharness@${cliVersion}`) && command.includes(" activation ")) own = 1;
  }
  return own + Object.values(record).reduce((sum, item) => sum + countActivationBashToolUses(item), 0);
}

async function observeClientVersion(client: Client, env: NodeJS.ProcessEnv): Promise<string> {
  try {
    const result = await runProcess(client === "claude-code" ? "claude" : "codex", ["--version"], {
      cwd: root,
      env,
      timeoutMs: 5_000
    });
    const lines = `${result.stdout}\n${result.stderr}`.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const observed = lines.find((line) => client === "codex" ? /^codex-cli\s+/i.test(line) : /claude code/i.test(line)) ?? lines[0];
    return observed && observed.length <= 80 ? observed : "unavailable";
  } catch {
    return "unavailable";
  }
}

function eligibleBootstrapOverlay(
  source: ManagedCapabilityIndex,
  candidate: ManagedCapability,
  checked: string,
  expires: string
): ManagedCapabilityIndex {
  const capability = structuredClone(candidate);
  capability.trust.status = "approved";
  capability.trust.reviewedAt = checked;
  capability.trust.limitations = [
    ...capability.trust.limitations.filter((item) => item !== "Candidate has not completed exact-release managed review"),
    "Bootstrap-only eligibility overlay is not human review evidence and cannot authorize promotion."
  ];
  capability.compatibility = (["claude-code", "codex"] as const).map((client) => ({
    client,
    status: "verified",
    verifiedAt: checked,
    notes: "Synthetic bootstrap transport eligibility only; no promotion evidence"
  }));
  const required = new Set([
    "schema",
    "artifact_digest",
    "source_license",
    "static_security",
    "capability_diff",
    "claude_code_activation",
    "codex_activation",
    "human_review"
  ]);
  capability.trust.checks = capability.trust.checks.map((check) => required.has(check.id) ? {
    ...check,
    status: "warn",
    checkedAt: checked,
    expiresAt: expires,
    summary: "Synthetic bootstrap eligibility only; not attestation or human review evidence"
  } : check);
  const result: ManagedCapabilityIndex = {
    schemaVersion: "superskill.index.v1",
    generatedAt: checked,
    capabilities: source.capabilities.map((item) => item.id === capability.id ? capability : item)
  };
  return managedCapabilityIndexSchema.parse(result);
}

function privateCapability(publicCandidate: ManagedCapability, fixture: LoadedPrivateReviewFixture): ManagedCapability {
  const capability = structuredClone(publicCandidate);
  capability.release.version = fixture.snapshot.version;
  capability.release.artifactDigest = fixture.snapshot.artifactDigest;
  capability.release.publishedAt = fixture.snapshot.createdAt;
  const contextFiles = fixture.snapshot.files.filter((file) => file.path === "README.md" || /^(agents|prompts|runbooks)\/.+\.md$/i.test(file.path));
  const bytes = contextFiles.reduce((sum, file) => sum + Buffer.byteLength(file.content, "utf8"), 0);
  capability.contextCost = {
    approxTokens: Math.round(bytes / 4),
    files: contextFiles.length,
    bytes,
    status: "estimated"
  };
  capability.trust.reviewedAt = fixture.snapshot.createdAt;
  capability.trust.limitations = [
    "Private candidate is available only inside the controlled review smoke.",
    "Human sign-off remains pending and this overlay cannot authorize promotion."
  ];
  return capability;
}

function privateArchiveBuilder(fixture: LoadedPrivateReviewFixture): (capability: ManagedCapability) => ManagedArchivePayload {
  return (capability) => {
    assert.equal(capability.id, fixture.snapshot.repo);
    assert.equal(capability.release.ref, `harnesses/${fixture.snapshot.repo}`);
    assert.equal(capability.release.version, fixture.snapshot.version);
    assert.equal(capability.release.artifactDigest, fixture.snapshot.artifactDigest);
    assert.equal(capability.release.delivery, "free_archive");
    assert.equal(fixture.snapshot.totalFileCount, fixture.snapshot.files.length);
    assert.equal(fixture.snapshot.archiveTruncated, false);
    assert.ok(fixture.snapshot.files.every((file) => file.truncated !== true));
    return {
      owner: "harnesses",
      repo: fixture.snapshot.repo,
      version: fixture.snapshot.version,
      snapshot: true,
      artifactDigest: fixture.snapshot.artifactDigest,
      totalFileCount: fixture.snapshot.files.length,
      archiveTruncated: false,
      files: fixture.snapshot.files.map((file) => ({ path: file.path, content: file.content, truncated: false }))
    };
  };
}

function privateChallengeValue(fixture: LoadedPrivateReviewFixture): string {
  const content = fixture.snapshot.files.find((file) => file.path === "runbooks/review-challenge.md")?.content ?? "";
  const match = /^review_challenge: (OHSC_[A-Za-z0-9_-]{43})$/m.exec(content);
  assert.ok(match, "Private review challenge is unavailable");
  return match[1];
}

function assertExactTuple(capability: ManagedCapability): void {
  assert.equal(capability.id, expected.id);
  assert.equal(capability.release.ref, expected.ref);
  assert.equal(capability.release.version, expected.version);
  assert.equal(capability.release.artifactDigest, expected.artifactDigest);
  assert.equal(capability.release.immutable, true);
  assert.equal(capability.release.delivery, "free_archive");
}

function nativeMarker(client: Client): string {
  return client === "claude-code"
    ? `.claude/skills/superskill-${expected.id}/.superskill-managed.json`
    : `.agents/skills/superskill-${expected.id}/.superskill-managed.json`;
}

function nativePinRoot(project: string, client: Client): string {
  return path.dirname(path.join(project, nativeMarker(client)));
}

function otherNativePinRoot(project: string, client: Client): string {
  return nativePinRoot(project, client === "claude-code" ? "codex" : "claude-code");
}

async function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<CliResult> {
  return runJson(process.execPath, [cliFile, ...args], { cwd: root, env, timeoutMs: 30_000 });
}

async function runJson(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }): Promise<CliResult> {
  const result = await runProcess(command, args, options);
  try {
    return JSON.parse(result.stdout) as CliResult;
  } catch {
    throw new Error(`Command returned invalid JSON: ${command} ${args.slice(0, 3).join(" ")} (${result.stdout.slice(0, 200)})`);
  }
}

async function runProcess(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Command timed out: ${command} ${args.slice(0, 3).join(" ")}`));
    }, options.timeoutMs ?? 10_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Command failed (${code}): ${command} ${args.slice(0, 3).join(" ")}\n${redact(stderr || stdout)}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function redact(value: string): string {
  return value.replaceAll(token, "[redacted]").replaceAll(temporaryRoot, "[temporary-root]").slice(0, 2_000);
}

function sourceTruthHashes(): Record<string, string> {
  const hashes = {
    curated: hashFile(curatedFile),
    index: hashFile(indexFile),
    history: hashFile(historyFile),
    reviews: hashTree(reviewsRoot),
    exactReleaseSnapshot: hashFile(exactSnapshotFile)
  };
  return privateFixture ? {
    ...hashes,
    privateReviewPacket: hashFile(path.join(root, "data/superskill/review-packets", `${expected.id}-${expected.version}.json`))
  } : hashes;
}

function hashFile(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function hashTree(directory: string): string {
  const hash = createHash("sha256");
  for (const file of listFiles(directory)) {
    hash.update(path.relative(directory, file).split(path.sep).join("/"));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function listFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const result: string[] = [];
  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) result.push(target);
    }
  };
  visit(directory);
  return result;
}

function readTextTree(directory: string): string {
  const chunks: string[] = [];
  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && statSync(target).size <= 512 * 1024) chunks.push(readFileSync(target, "utf8"));
    }
  };
  visit(directory);
  return chunks.join("\n");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

type SmokeArguments = {
  realClientSessions: boolean;
  privateFixture: boolean;
  realClient?: Client;
  evidenceOut?: string;
  capabilityId?: string;
  ref?: string;
  version?: string;
  digest?: string;
  taskSummary?: string;
};

type ExpectedTuple = {
  id: string;
  ref: string;
  version: string;
  artifactDigest: string;
};

function parseArguments(args: string[]): SmokeArguments {
  const parsed: SmokeArguments = { realClientSessions: false, privateFixture: false };
  const seen = new Set<string>();
  const values = new Set([
    "--real-client",
    "--evidence-out",
    "--capability-id",
    "--ref",
    "--version",
    "--digest",
    "--task-summary"
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (seen.has(argument)) throw new Error(`${argument} may only be provided once`);
    seen.add(argument);
    if (argument === "--real-client-sessions") {
      parsed.realClientSessions = true;
      continue;
    }
    if (argument === "--private-fixture") {
      parsed.privateFixture = true;
      continue;
    }
    if (!values.has(argument)) throw new Error(`Unknown argument: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    index += 1;
    if (argument === "--real-client") {
      if (value !== "claude-code" && value !== "codex") throw new Error("--real-client must be claude-code or codex");
      parsed.realClient = value;
    } else if (argument === "--evidence-out") parsed.evidenceOut = value;
    else if (argument === "--capability-id") parsed.capabilityId = value;
    else if (argument === "--ref") parsed.ref = value;
    else if (argument === "--version") parsed.version = value;
    else if (argument === "--digest") parsed.digest = value;
    else if (argument === "--task-summary") parsed.taskSummary = value;
  }
  return parsed;
}

function resolveExpectedTuple(candidate: ManagedCapability, args: SmokeArguments): ExpectedTuple {
  assertCapabilityId(candidate.id);
  assertCapabilityRef(candidate.release.ref, candidate.id);
  assertVersion(candidate.release.version);
  assertArtifactDigest(candidate.release.artifactDigest);
  const expected: ExpectedTuple = {
    id: candidate.id,
    ref: candidate.release.ref,
    version: candidate.release.version,
    artifactDigest: candidate.release.artifactDigest
  };
  if (args.capabilityId === undefined && args.ref === undefined && args.version === undefined && args.digest === undefined) {
    assert.deepEqual(expected, defaultExpected, "Default smoke release no longer matches the pinned deep-market-researcher tuple");
  }
  if (args.ref !== undefined) {
    assertCapabilityRef(args.ref, expected.id);
    assert.equal(args.ref, expected.ref, `--ref does not match checked-in release for ${expected.id}`);
  }
  if (args.version !== undefined) {
    assertVersion(args.version);
    assert.equal(args.version, expected.version, `--version does not match checked-in release for ${expected.id}`);
  }
  if (args.digest !== undefined) {
    assertArtifactDigest(args.digest);
    assert.equal(args.digest, expected.artifactDigest, `--digest does not match checked-in release for ${expected.id}`);
  }
  return expected;
}

function resolveTaskSummary(
  expected: ExpectedTuple,
  explicit: string | undefined,
  publicCandidate: ManagedCapability,
  privateMode: boolean
): string {
  const curated = JSON.parse(readFileSync(curatedFile, "utf8")) as {
    resources?: Array<{
      id?: unknown;
      ref?: unknown;
      version?: unknown;
      expectedDigest?: unknown;
      status?: unknown;
      jobs?: Array<{ intents?: unknown; outcomes?: unknown }>;
    }>;
  };
  const matches = curated.resources?.filter((resource) => resource.id === expected.id) ?? [];
  assert.equal(matches.length, 1, `Expected exactly one curated source row for ${expected.id}`);
  const resource = matches[0]!;
  assert.equal(resource.ref, expected.ref, `Curated ref mismatch for ${expected.id}`);
  assert.equal(resource.version, privateMode ? publicCandidate.release.version : expected.version, `Curated version mismatch for ${expected.id}`);
  assert.equal(resource.expectedDigest, privateMode ? publicCandidate.release.artifactDigest : expected.artifactDigest, `Curated digest mismatch for ${expected.id}`);
  assert.equal(resource.status, "candidate", `Curated ${expected.id} must remain candidate during bootstrap smoke`);
  if (explicit !== undefined) return validateTaskSummary(explicit);
  if (expected.id === defaultExpected.id) return defaultTaskSummary;
  return deriveCuratedSmokeTask(resource, expected.id);
}

function validateTaskSummary(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  assert.ok(normalized.length >= 3 && normalized.length <= 256, "--task-summary must contain 3 to 256 characters");
  assert.equal(/[\u0000-\u001f\u007f]/.test(normalized), false, "--task-summary must not contain control characters");
  return normalized;
}

function assertCapabilityId(value: string): void {
  assert.match(value, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Capability id must be a lowercase kebab-case slug");
  assert.ok(value.length <= 80, "Capability id must not exceed 80 characters");
}

function assertCapabilityRef(value: string, id: string): void {
  assert.equal(value, `harnesses/${id}`, `Capability ref must be exactly harnesses/${id}`);
}

function assertVersion(value: string): void {
  assert.match(value, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/, "Version must be a valid exact semver");
}

function assertArtifactDigest(value: string): void {
  assert.match(value, /^sha256:[0-9a-f]{64}$/, "Artifact digest must be a lowercase sha256 digest");
}

function resolveEvidenceOutput(argument: string, capabilityId: string, version: string): string {
  assert.equal(path.extname(argument), ".json", "--evidence-out must name a .json file");
  const evidenceRoot = realpathSync(evidenceDirectory);
  const output = path.resolve(root, argument);
  const parent = path.dirname(output);
  assert.ok(existsSync(parent), "--evidence-out parent directory must already exist");
  const realParent = realpathSync(parent);
  assert.ok(isContainedPath(evidenceRoot, realParent), "--evidence-out parent must resolve under docs/plans/superskill-mvp/evidence");
  assert.ok(path.basename(output).includes(`${capabilityId}-${version}`), "--evidence-out filename must include the exact capability id and version");
  if (existsSync(output)) {
    assert.equal(lstatSync(output).isSymbolicLink(), false, "--evidence-out must not overwrite a symlink");
    assert.ok(isContainedPath(evidenceRoot, realpathSync(output)), "--evidence-out target must resolve under docs/plans/superskill-mvp/evidence");
  }
  return output;
}

function isContainedPath(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
